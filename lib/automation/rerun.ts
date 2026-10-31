import { createAdminClient } from '@/lib/supabase/admin'
import { loadProgram, runProgramRouting } from '@/lib/programs/routing'
import { runMasterOemRouting } from '@/lib/requests/master-routing'
import { runAutoCvmApproval } from '@/lib/cvm/auto-approval'
import { loadCvmCandidates } from '@/lib/cvm/load'
import { loadCvmEmail } from '@/lib/masters/resolve'
import { inBatchesDo } from '@/lib/queries/in-batches'
import { isOemKind } from '@/lib/oems/kinds'
import { addressWithPincode } from '@/lib/stores/details'
import { runCreatedAssignRules } from './assign-rules'
import { AUTO_MAX_ATTEMPTS, chosenValues, diagnoseTicket, diagnoseTickets, isMailExpected, type AutomationDiagnosis, type Db, type ExpectedSteps, type StepKey, type StepState } from './diagnose'

// Runs the steps of a ticket's automation that did not happen, and ONLY those (lib/automation/diagnose.ts decides what is missing from what really exists on the ticket), so a step
// that worked is never repeated: no second mail to the OEM, no second approval. Three callers:
//  - an administrator / platform owner pressing "Run automation again" on the ticket (mode "manual");
//  - the 15-minute retry job (mode "auto"): only steps marked autoSafe, at most 3 tries per ticket, then it gives up and leaves a note;
//  - the markers below, written by the ticket-creation code so we know how far a NEW ticket got.
//
// Why a step cannot run twice (the button and the 15-minute job at the same moment, two clicks, a restart in the middle):
//  1. ONE claim for both callers: request_automation_state.running_since, taken with a single conditional update and released at the end (a claim older than 10 minutes belongs to a
//     run that died and is taken over). Whoever loses the claim does nothing.
//  2. After the claim the ticket is judged AGAIN, and again right before every step, so a step another run just finished is seen as done.
//  3. The mail to the OEM writes "mail_started_at" before it sends and clears it when the try ended cleanly without a mail. If the server dies in the middle, the marker stays and the
//     ticket says "may or may not have gone out": only a person can run that step then, the automatic retry never repeats it.

const MANUAL_WAIT_MS = 3 * 60_000
const AUTO_WAIT_MS = 15 * 60_000
const RUN_STALE_MS = 10 * 60_000

// ── Markers written while a ticket is being made (never throw: the ticket must not be lost because of them) ──

/** Which automatic steps this ticket is expected to have, from its category / program / service as they are right now (at creation). null when it cannot be told. */
export async function expectedStepsFor(db: Db, requestId: string): Promise<ExpectedSteps | null> {
  try {
    const { data: r, error } = await db.from('requests').select('category_id, service_id').eq('id', requestId).maybeSingle()
    if (error || !r) return null
    let cat: { program_id: string | null; auto_oem_kind: string | null; is_pms: boolean | null; auto_cvm_approval: boolean | null } | null = null
    if (r.category_id) {
      const res = await db.from('service_categories').select('program_id, auto_oem_kind, is_pms, auto_cvm_approval').eq('id', r.category_id).maybeSingle()
      if (res.error) return null
      cat = res.data
    }
    let svcOem = false
    if (r.service_id) {
      const res = await db.from('services').select('auto_oem_routing').eq('id', r.service_id).maybeSingle()
      if (res.error) return null
      svcOem = res.data?.auto_oem_routing === true
    }
    let programActive = false
    if (cat?.program_id) {
      const res = await db.from('vendor_programs').select('is_active').eq('id', cat.program_id).maybeSingle()
      if (res.error) return null
      programActive = res.data?.is_active === true
    }
    const programId = cat?.program_id ?? null
    const oemFromCat = isOemKind(cat?.auto_oem_kind) ? cat!.auto_oem_kind : null
    const oemKind = programId ? null : (oemFromCat ?? (svcOem ? 'ac' : null))
    return {
      rules: true,   // the Business Rules of the "created" trigger run for every ticket
      vendor_mail: isMailExpected({ programId, programActive, oemKind: oemKind as never, isPms: cat?.is_pms === true }),
      cvm: cat?.auto_cvm_approval === true,
    }
  } catch (e) {
    console.error('[automation] could not work out the expected steps', e)
    return null
  }
}

export async function markAutomationStarted(db: Db, orgId: string, requestId: string): Promise<void> {
  try {
    const expected = await expectedStepsFor(db, requestId)
    await db.from('request_automation_state').upsert({ request_id: requestId, org_id: orgId, expected_steps: expected }, { onConflict: 'request_id', ignoreDuplicates: true })
  } catch (e) { console.error('[automation] mark started failed', e) }
}
export async function markRulesRan(db: Db, requestId: string): Promise<void> {
  try { await db.from('request_automation_state').update({ rules_ran_at: new Date().toISOString() }).eq('request_id', requestId) } catch (e) { console.error('[automation] mark rules failed', e) }
}
export async function markAutomationFinished(db: Db, requestId: string): Promise<void> {
  try { await db.from('request_automation_state').update({ finished_at: new Date().toISOString() }).eq('request_id', requestId).is('finished_at', null) } catch (e) { console.error('[automation] mark finished failed', e) }
}

// ── Running the missing steps ──

export type RerunOutcome = { key: StepKey; label: string; before: StepState; after: StepState; detail: string }
export type RerunResult = { ok: boolean; error?: string; message: string; outcomes: RerunOutcome[] }

type RunContext = {
  orgId: string
  request: { id: string; request_no: string }
  title: string
  description: string
  requesterId: string
  requesterName: string
  requesterEmail: string
  requesterPhone: string
  storeId: string | null
  storeCode: string | null
  storeAddress: string | null
  categoryName: string | null
}

async function loadRunContext(db: Db, admin: ReturnType<typeof createAdminClient>, requestId: string): Promise<RunContext | null> {
  const { data: r } = await db.from('requests').select('id, request_no, org_id, title, description, form_data, form_sections_snapshot, requester_id, category_id').eq('id', requestId).maybeSingle()
  if (!r) return null
  const [{ data: prof }, { data: cat }] = await Promise.all([
    db.from('profiles').select('full_name, store_id').eq('id', r.requester_id).maybeSingle(),
    r.category_id ? db.from('service_categories').select('name').eq('id', r.category_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  let storeCode: string | null = null
  let storeAddress: string | null = null
  if (prof?.store_id) {
    const { data: st } = await db.from('stores').select('code, address, pincode').eq('id', prof.store_id).maybeSingle()
    storeCode = st?.code ? String(st.code).toUpperCase() : null
    storeAddress = addressWithPincode(st?.address, st?.pincode) || null
  }
  const { data: authUser } = await admin.auth.admin.getUserById(r.requester_id)
  // description, phone and e-mail come from the form the store filled in (the same fields the first e-mail used)
  const sections = (Array.isArray(r.form_sections_snapshot) ? r.form_sections_snapshot : []) as { fields?: { id: string; type: string }[] }[]
  const fields = sections.flatMap((s) => s.fields ?? [])
  const data = (r.form_data ?? {}) as Record<string, unknown>
  const text = (type: string) => { const f = fields.find((x) => x.type === type); return f ? String(data[f.id] ?? '').trim() : '' }
  return {
    orgId: r.org_id, request: { id: r.id, request_no: r.request_no }, title: r.title, description: r.description || text('textarea'), requesterId: r.requester_id,
    requesterName: prof?.full_name ?? '', requesterEmail: text('email') || authUser?.user?.email || '', requesterPhone: text('phone'),
    storeId: prof?.store_id ?? null, storeCode, storeAddress, categoryName: cat?.name ?? null,
  }
}

const plain: Record<StepState, string> = { done: 'done', missing: 'still missing', blocked: 'cannot be done yet', not_needed: 'not needed' }

const ORDER: StepKey[] = ['rules', 'vendor_mail', 'cvm']

/**
 * Runs what is missing on one ticket. mode "manual": an administrator pressed the button (every missing step); mode "auto": the retry job (only steps that are safe to repeat by
 * themselves). `actor` is the person for a manual run; an automatic run is written as the ticket's own requester, like the first automatic steps were.
 * The public messages the steps write ("Ticket sent to the ... OEM", the CVM greeting) are ALWAYS written as the ticket's requester, exactly like the first automatic run, never as
 * the administrator; the administrator's name is in the internal note that tells what was done.
 */
export async function rerunAutomation(p: { requestId: string; mode: 'manual' | 'auto'; actor?: { id: string; name: string }; now?: Date }): Promise<RerunResult> {
  const admin = createAdminClient()
  const db = admin as unknown as Db
  const fail = (msg: string): RerunResult => ({ ok: false, error: msg, message: msg, outcomes: [] })
  const manual = p.mode === 'manual'

  let before: AutomationDiagnosis | null
  try { before = await diagnoseTicket(db, p.requestId) } catch (e) { console.error('[automation] could not check the ticket', e); return fail('The ticket could not be checked just now. Please try again in a minute.') }
  if (!before) return fail('Ticket not found.')
  if (!before.eligible) return { ok: false, error: before.ineligibleReason, message: before.ineligibleReason ?? 'Nothing to run.', outcomes: [] }

  const wanted = (d: AutomationDiagnosis) => d.steps.filter((s) => s.state === 'missing' && (manual || s.autoSafe))
  if (wanted(before).length === 0) {
    const blocked = before.steps.filter((s) => s.state === 'blocked')
    return { ok: true, message: blocked.length ? `Nothing can be run now. ${blocked.map((b) => `${b.label}: ${b.detail}`).join(' ')}` : 'Nothing is missing, so nothing was run.', outcomes: [] }
  }

  // ONE claim for the button and the 15-minute job: a single conditional update. Two clicks, or a click and the job, cannot both pass.
  const now = p.now ?? new Date()
  const nowIso = now.toISOString()
  const { data: reqRow } = await db.from('requests').select('org_id').eq('id', p.requestId).single()
  const up = await db.from('request_automation_state').upsert({ request_id: p.requestId, org_id: reqRow?.org_id }, { onConflict: 'request_id', ignoreDuplicates: true })
  if (up?.error) return fail('The automation record of this ticket could not be saved. Please try again in a minute.')
  const column = manual ? 'last_rerun_at' : 'auto_last_at'
  const wait = manual ? MANUAL_WAIT_MS : AUTO_WAIT_MS
  // free = nobody is running it (or the claim is stale), and not run too recently by this kind of caller: (R is null or R < stale) AND (C is null or C < waited), written as one OR of the
  // four combinations so it is a single condition of a single update
  const stale = new Date(now.getTime() - RUN_STALE_MS).toISOString()
  const waited = new Date(now.getTime() - wait).toISOString()
  const claim = await db.from('request_automation_state')
    .update({ running_since: nowIso, [column]: nowIso, ...(manual ? { last_rerun_by: p.actor?.id ?? null } : {}) })
    .eq('request_id', p.requestId)
    .or(`and(running_since.is.null,${column}.is.null),and(running_since.is.null,${column}.lt.${waited}),and(running_since.lt.${stale},${column}.is.null),and(running_since.lt.${stale},${column}.lt.${waited})`)
    .select('request_id')
  if (!claim.data?.length) {
    const { data: st } = await db.from('request_automation_state').select('running_since').eq('request_id', p.requestId).maybeSingle()
    const running = st?.running_since && now.getTime() - new Date(st.running_since as string).getTime() < RUN_STALE_MS
    return fail(running ? 'The automation of this ticket is being run at this moment (by someone else or by the automatic retry). Please look again in a minute.' : 'It was run a moment ago. Please wait a few minutes and look again.')
  }
  const release = async () => { await db.from('request_automation_state').update({ running_since: null }).eq('request_id', p.requestId).eq('running_since', nowIso) }

  try {
    const ctx = await loadRunContext(db, admin, p.requestId)
    if (!ctx) return fail('Ticket not found.')
    // the public messages of the steps are written as the requester, as the first automatic run wrote them
    const actorId = ctx.requesterId
    const errors: string[] = []

    // judged AGAIN now that this run holds the claim: another run may have finished a step since the first look
    let current: AutomationDiagnosis | null = await diagnoseTicket(db, p.requestId)
    const toRun = current ? wanted(current) : []
    if (!current || toRun.length === 0) return { ok: true, message: 'Nothing is missing, so nothing was run.', outcomes: [] }
    const ranKeys: StepKey[] = []

    for (const key of ORDER) {
      if (!toRun.some((s) => s.key === key)) continue
      // each step is judged again right before it runs (the step before it may have changed the ticket: the rules may have given it to somebody, the CVM step may have moved it on)
      if (ranKeys.length > 0) current = await diagnoseTicket(db, p.requestId)
      const step = current?.eligible ? current.steps.find((s) => s.key === key) : undefined
      if (!step || step.state !== 'missing' || (!manual && !step.autoSafe)) continue
      ranKeys.push(key)

      if (key === 'rules') {
        try {
          // only the ASSIGN actions: the notifications, priority and status of the "created" rules already ran when the ticket was made and must not be repeated or undo what an agent changed
          await runCreatedAssignRules(p.requestId)
          await markRulesRan(db, p.requestId)
        } catch (e) { console.error('[automation] rules failed', e); errors.push('rules') }
      } else if (key === 'vendor_mail') {
        try {
          const { data: row } = await db.from('requests').select('category_id, service_id, form_data, form_sections_snapshot').eq('id', p.requestId).single()
          const { data: cat } = row?.category_id ? await db.from('service_categories').select('auto_oem_kind, program_id').eq('id', row.category_id).maybeSingle() : { data: null }
          const { data: svc } = row?.service_id ? await db.from('services').select('auto_oem_routing').eq('id', row.service_id).maybeSingle() : { data: null }
          const chosen = chosenValues(row?.form_sections_snapshot, row?.form_data)
          const base = {
            admin, actorId, orgId: ctx.orgId, request: ctx.request, storeCode: ctx.storeCode, categoryName: ctx.categoryName, title: ctx.title, description: ctx.description,
            requesterName: ctx.requesterName, requesterEmail: ctx.requesterEmail, requesterPhone: ctx.requesterPhone, storeAddress: ctx.storeAddress,
          }
          // written BEFORE anything can be sent: if the server dies between the mail and its message, the ticket says "may or may not have gone out" instead of being mailed twice
          await db.from('request_automation_state').update({ mail_started_at: new Date().toISOString() }).eq('request_id', p.requestId)
          if (cat?.program_id) {
            const program = await loadProgram(db, ctx.orgId, cat.program_id)
            if (program?.is_active) await runProgramRouting({ ...base, program, machineValue: chosen.machine || undefined })
          } else {
            const kind = cat?.auto_oem_kind === 'ac' || cat?.auto_oem_kind === 'genset' ? cat.auto_oem_kind : svc?.auto_oem_routing ? 'ac' : null
            if (kind) await runMasterOemRouting({ ...base, kind, chosenAcValue: chosen.ac, quiet: !(cat?.auto_oem_kind === 'ac' || cat?.auto_oem_kind === 'genset') })
          }
          // the try ended cleanly: when no mail went out (nothing to send to, or the send failed and said so) the marker is cleared so the step can be tried again
          const done = await diagnoseTicket(db, p.requestId)
          if (done?.steps.find((s) => s.key === 'vendor_mail')?.state !== 'done') await db.from('request_automation_state').update({ mail_started_at: null }).eq('request_id', p.requestId)
        } catch (e) { console.error('[automation] vendor mail failed', e); errors.push('vendor_mail') }
      } else {
        try {
          let cvmId: string | null = null
          let cvmEmail: string | null = null
          if (ctx.storeCode) {
            cvmEmail = await loadCvmEmail(db as never, ctx.orgId, ctx.storeCode)
            if (cvmEmail) cvmId = (await loadCvmCandidates(ctx.orgId)).byEmail.get(cvmEmail) ?? null
          }
          await runAutoCvmApproval({ admin, orgId: ctx.orgId, request: { id: ctx.request.id, request_no: ctx.request.request_no ?? null, title: ctx.title }, requesterId: ctx.requesterId, actorId, hasStore: !!ctx.storeId, storeCvmId: cvmId, cvmEmailInSheet: cvmEmail })
        } catch (e) { console.error('[automation] CVM failed', e); errors.push('cvm') }
      }
    }

    const after = (await diagnoseTicket(db, p.requestId)) as AutomationDiagnosis
    const outcomes: RerunOutcome[] = toRun.filter((s) => ranKeys.includes(s.key)).map((s) => {
      const a = after.steps.find((x) => x.key === s.key)
      return { key: s.key, label: s.label, before: s.state, after: a?.state ?? 'done', detail: a?.detail ?? '' }
    })
    if (outcomes.length === 0) return { ok: true, message: 'Nothing is missing any more (another run did it just now), so nothing was run.', outcomes: [] }
    const stillMissing = after.steps.filter((s) => s.state === 'missing' && (manual || s.autoSafe))

    // what to remember about this run
    const { data: st } = await db.from('request_automation_state').select('rerun_count, auto_attempts').eq('request_id', p.requestId).single()
    const patch: Record<string, unknown> = { last_result: { at: nowIso, mode: p.mode, by: p.actor?.name ?? 'automatic retry', outcomes } }
    if (manual) patch.rerun_count = Number(st?.rerun_count ?? 0) + 1
    else patch.auto_attempts = Number(st?.auto_attempts ?? 0) + 1
    const gaveUp = !manual && stillMissing.length > 0 && Number(st?.auto_attempts ?? 0) + 1 >= AUTO_MAX_ATTEMPTS
    if (gaveUp) patch.gave_up_at = nowIso
    if (!after.steps.some((s) => s.state === 'missing')) patch.finished_at = nowIso
    if (!after.autoPending) patch.settled_at = nowIso
    await db.from('request_automation_state').update(patch).eq('request_id', p.requestId)

    // a short internal note, so the ticket itself tells the story (the administrator's name is in the text)
    const lines = outcomes.map((o) => `- ${o.label}: ${plain[o.after]}${o.after === 'done' ? '' : ` (${o.detail})`}`)
    const head = manual ? `${p.actor?.name ?? 'An administrator'} ran the automation of this ticket again.` : 'The automatic retry ran the steps of this ticket that had not happened.'
    const tail = gaveUp ? '\nThe automatic retry has now tried 3 times and stops. An administrator can run it again from this ticket.' : ''
    const noteRes = await db.from('request_comments').insert({ request_id: p.requestId, author_id: manual ? (p.actor?.id ?? actorId) : actorId, is_internal: true, body: `${head}\n${lines.join('\n')}${tail}` })
    if (noteRes?.error) console.error('[automation] could not write the note on the ticket', noteRes.error.message)

    const failed = outcomes.filter((o) => o.after === 'missing' || o.after === 'blocked')
    return {
      ok: errors.length === 0,
      error: errors.length ? 'Part of it could not run. Please look at the ticket notes.' : undefined,
      message: failed.length === 0 ? 'Done. Every step that was missing has now happened.' : `Ran, but not everything could be done: ${failed.map((f) => `${f.label} (${f.detail})`).join('; ')}`,
      outcomes,
    }
  } catch (e) {
    console.error('[automation] run failed', p.requestId, e)
    return fail('The automation could not be run just now. Please try again in a minute.')
  } finally {
    await release().catch(() => {})
  }
}

// ── The 15-minute retry job ──

export type RetryResult = { looked: number; retried: number; fixed: number; gaveUp: number }

const PAGE = 100
/** The most tickets one run looks at (a few hundred is a very busy three days; the rest wait for the next run, oldest-looked-at first). */
const MAX_LOOKED_PER_RUN = 1000
/** The most tickets one run runs steps for (so a long outage does not become a burst of mails). */
const MAX_RETRIED_PER_RUN = 40

/**
 * Called by the cron job "automation-retry": retries what is safe to retry on tickets made since this feature exists, newer than 3 days and older than 10 minutes.
 *  - A ticket whose automatic steps are all fine (or that has nothing the retry may do) is marked "settled" and is not looked at again.
 *  - The tickets are taken the ones looked at LEAST recently first (never-looked-at before everything), so a pile of tickets that wait for a sheet can never keep newer
 *    broken tickets from being examined.
 *  - A ticket is only retried for steps it was EXPECTED to have when it was made; changes to the categories / programs / sheets since then do not count.
 */
export async function runAutomationRetry(db: Db, now: Date = new Date()): Promise<RetryResult> {
  const out: RetryResult = { looked: 0, retried: 0, fixed: 0, gaveUp: 0 }
  const nowIso = now.toISOString()
  const from = new Date(now.getTime() - 3 * 24 * 3600_000).toISOString()
  const to = new Date(now.getTime() - 10 * 60_000).toISOString()
  const waited = new Date(now.getTime() - AUTO_WAIT_MS).toISOString()
  let budget = MAX_RETRIED_PER_RUN

  while (out.looked < MAX_LOOKED_PER_RUN) {
    const { data: rows, error } = await db.from('request_automation_state').select('request_id')
      .gte('started_at', from).lte('started_at', to).is('gave_up_at', null).is('settled_at', null).lt('auto_attempts', AUTO_MAX_ATTEMPTS)
      // not looked at in this run yet, and not retried in the last 15 minutes: (checked is null or < now) AND (last is null or < waited), as one OR of the four combinations
      .or(`and(auto_checked_at.is.null,auto_last_at.is.null),and(auto_checked_at.is.null,auto_last_at.lt.${waited}),and(auto_checked_at.lt.${nowIso},auto_last_at.is.null),and(auto_checked_at.lt.${nowIso},auto_last_at.lt.${waited})`)
      .order('auto_checked_at', { ascending: true, nullsFirst: true }).order('started_at', { ascending: false }).limit(PAGE)
    if (error) { console.error('[automation] retry could not read the list', error.message); break }
    const ids = ((rows ?? []) as { request_id: string }[]).map((r) => r.request_id)
    if (ids.length === 0) break
    out.looked += ids.length
    // looked-at is written first: whatever happens next, these tickets go to the back of the queue
    const stamped = await inBatchesDo(ids, (b) => db.from('request_automation_state').update({ auto_checked_at: nowIso }).in('request_id', b))
    if (stamped.error) { console.error('[automation] retry could not mark the tickets as looked at', stamped.error.message); break }

    let diagnoses: AutomationDiagnosis[]
    try { diagnoses = await diagnoseTickets(db, ids, { check: true }, now) } catch (e) { console.error('[automation] retry could not check a page of tickets', e); break }
    const settle: string[] = []
    const finish: string[] = []
    for (const d of diagnoses) {
      if (!d.autoPending) {
        settle.push(d.requestId)   // nothing the retry may do, now or later
        if (d.eligible && !d.steps.some((s) => s.state === 'missing')) finish.push(d.requestId)
        continue
      }
      if (!d.steps.some((s) => s.state === 'missing' && s.autoSafe)) continue   // waiting for a sheet / a CVM to be fixed: look again next time
      if (budget <= 0) continue
      budget--
      try {
        const res = await rerunAutomation({ requestId: d.requestId, mode: 'auto', now })
        if (res.outcomes.length > 0) {
          out.retried++
          if (res.outcomes.every((o) => o.after === 'done')) out.fixed++
        }
      } catch (e) {
        console.error('[automation] retry failed for', d.requestId, e)
      }
    }
    if (settle.length) await inBatchesDo(settle, (b) => db.from('request_automation_state').update({ settled_at: nowIso }).in('request_id', b).is('settled_at', null))
    if (finish.length) await inBatchesDo(finish, (b) => db.from('request_automation_state').update({ finished_at: nowIso }).in('request_id', b).is('finished_at', null))
    if (ids.length < PAGE) break
  }
  const { count } = await db.from('request_automation_state').select('request_id', { count: 'exact', head: true }).gte('gave_up_at', new Date(now.getTime() - AUTO_WAIT_MS).toISOString())
  out.gaveUp = count ?? 0
  return out
}
