import { createAdminClient } from '@/lib/supabase/admin'
import { loadProgram, runProgramRouting } from '@/lib/programs/routing'
import { runMasterOemRouting } from '@/lib/requests/master-routing'
import { runAutoCvmApproval } from '@/lib/cvm/auto-approval'
import { loadCvmCandidates } from '@/lib/cvm/load'
import { loadCvmEmail } from '@/lib/masters/resolve'
import { AUTO_MAX_ATTEMPTS, chosenValues, diagnoseTicket, diagnoseTickets, type AutomationDiagnosis, type Db, type StepKey, type StepState } from './diagnose'

// Runs the steps of a ticket's automation that did not happen, and ONLY those (lib/automation/diagnose.ts decides what is missing from what really exists on the ticket), so a step
// that worked is never repeated: no second mail to the OEM, no second approval. Three callers:
//  - an administrator / platform owner pressing "Run automation again" on the ticket (mode "manual");
//  - the 15-minute retry job (mode "auto"): only steps marked autoSafe, at most 3 tries per ticket, then it gives up and leaves a note;
//  - the markers below, written by the ticket-creation code so we know how far a NEW ticket got.

const MANUAL_WAIT_MS = 3 * 60_000
const AUTO_WAIT_MS = 15 * 60_000

// ── Markers written while a ticket is being made (never throw: the ticket must not be lost because of them) ──

export async function markAutomationStarted(db: Db, orgId: string, requestId: string): Promise<void> {
  try { await db.from('request_automation_state').upsert({ request_id: requestId, org_id: orgId }, { onConflict: 'request_id', ignoreDuplicates: true }) } catch (e) { console.error('[automation] mark started failed', e) }
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
    const { data: st } = await db.from('stores').select('code, address').eq('id', prof.store_id).maybeSingle()
    storeCode = st?.code ? String(st.code).toUpperCase() : null
    storeAddress = st?.address ?? null
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

/**
 * Runs what is missing on one ticket. mode "manual": an administrator pressed the button (every missing step); mode "auto": the retry job (only steps that are safe to repeat by
 * themselves). `actor` is the person for a manual run; an automatic run is written as the ticket's own requester, like the first automatic steps were.
 */
export async function rerunAutomation(p: { requestId: string; mode: 'manual' | 'auto'; actor?: { id: string; name: string }; now?: Date }): Promise<RerunResult> {
  const admin = createAdminClient()
  const db = admin as unknown as Db
  const before = await diagnoseTicket(db, p.requestId)
  if (!before) return { ok: false, error: 'Ticket not found.', message: 'Ticket not found.', outcomes: [] }
  if (!before.eligible) return { ok: false, error: before.ineligibleReason, message: before.ineligibleReason ?? 'Nothing to run.', outcomes: [] }

  const toRun = before.steps.filter((s) => s.state === 'missing' && (p.mode === 'manual' || s.autoSafe))
  if (toRun.length === 0) {
    const blocked = before.steps.filter((s) => s.state === 'blocked')
    return { ok: true, message: blocked.length ? `Nothing can be run now. ${blocked.map((b) => `${b.label}: ${b.detail}`).join(' ')}` : 'Nothing is missing, so nothing was run.', outcomes: [] }
  }

  // Two clicks at once, or the button and the retry job together, run it only once: the row is claimed in ONE database step.
  await db.from('request_automation_state').upsert({ request_id: p.requestId, org_id: (await db.from('requests').select('org_id').eq('id', p.requestId).single()).data?.org_id }, { onConflict: 'request_id', ignoreDuplicates: true })
  const now = p.now ?? new Date()
  const column = p.mode === 'manual' ? 'last_rerun_at' : 'auto_last_at'
  const wait = p.mode === 'manual' ? MANUAL_WAIT_MS : AUTO_WAIT_MS
  const claim = await db.from('request_automation_state')
    .update({ [column]: now.toISOString(), ...(p.mode === 'manual' ? { last_rerun_by: p.actor?.id ?? null } : {}) })
    .eq('request_id', p.requestId).or(`${column}.is.null,${column}.lt.${new Date(now.getTime() - wait).toISOString()}`).select('request_id')
  if (!claim.data?.length) return { ok: false, error: 'It was run a moment ago. Please wait a few minutes and look again.', message: 'It was run a moment ago. Please wait a few minutes and look again.', outcomes: [] }

  const ctx = await loadRunContext(db, admin, p.requestId)
  if (!ctx) return { ok: false, error: 'Ticket not found.', message: 'Ticket not found.', outcomes: [] }
  const actorId = p.actor?.id ?? ctx.requesterId
  const errors: string[] = []
  const wants = (k: StepKey) => toRun.some((s) => s.key === k)

  if (wants('rules')) {
    try {
      const { runRulesForTrigger } = await import('@/lib/rules/run')
      await runRulesForTrigger('created', p.requestId)
      await markRulesRan(db, p.requestId)
    } catch (e) { console.error('[automation] rules failed', e); errors.push('rules') }
  }
  if (wants('vendor_mail')) {
    try {
      // the ticket may have been given to somebody by the rules just now; the mail step looks at the ticket as it is
      const fresh = await diagnoseTicket(db, p.requestId)
      if (fresh?.steps.find((s) => s.key === 'vendor_mail')?.state === 'missing') {
        const { data: row } = await db.from('requests').select('category_id, service_id, form_data, form_sections_snapshot').eq('id', p.requestId).single()
        const { data: cat } = row?.category_id ? await db.from('service_categories').select('auto_oem_kind, program_id').eq('id', row.category_id).maybeSingle() : { data: null }
        const { data: svc } = row?.service_id ? await db.from('services').select('auto_oem_routing').eq('id', row.service_id).maybeSingle() : { data: null }
        const chosen = chosenValues(row?.form_sections_snapshot, row?.form_data)
        const base = {
          admin, actorId, orgId: ctx.orgId, request: ctx.request, storeCode: ctx.storeCode, categoryName: ctx.categoryName, title: ctx.title, description: ctx.description,
          requesterName: ctx.requesterName, requesterEmail: ctx.requesterEmail, requesterPhone: ctx.requesterPhone, storeAddress: ctx.storeAddress,
        }
        if (cat?.program_id) {
          const program = await loadProgram(db, ctx.orgId, cat.program_id)
          if (program?.is_active) await runProgramRouting({ ...base, program, machineValue: chosen.machine || undefined })
        } else {
          const kind = cat?.auto_oem_kind === 'ac' || cat?.auto_oem_kind === 'genset' ? cat.auto_oem_kind : svc?.auto_oem_routing ? 'ac' : null
          if (kind) await runMasterOemRouting({ ...base, kind, chosenAcValue: chosen.ac, quiet: !(cat?.auto_oem_kind === 'ac' || cat?.auto_oem_kind === 'genset') })
        }
      }
    } catch (e) { console.error('[automation] vendor mail failed', e); errors.push('vendor_mail') }
  }
  if (wants('cvm')) {
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

  const after = (await diagnoseTicket(db, p.requestId)) as AutomationDiagnosis
  const outcomes: RerunOutcome[] = toRun.map((s) => {
    const a = after.steps.find((x) => x.key === s.key)
    return { key: s.key, label: s.label, before: s.state, after: a?.state ?? 'done', detail: a?.detail ?? '' }
  })
  const stillMissing = after.steps.filter((s) => s.state === 'missing' && (p.mode === 'manual' || s.autoSafe))

  // what to remember about this run
  const { data: st } = await db.from('request_automation_state').select('rerun_count, auto_attempts').eq('request_id', p.requestId).single()
  const patch: Record<string, unknown> = { last_result: { at: now.toISOString(), mode: p.mode, by: p.actor?.name ?? 'automatic retry', outcomes } }
  if (p.mode === 'manual') patch.rerun_count = Number(st?.rerun_count ?? 0) + 1
  else patch.auto_attempts = Number(st?.auto_attempts ?? 0) + 1
  const gaveUp = p.mode === 'auto' && stillMissing.length > 0 && Number(st?.auto_attempts ?? 0) + 1 >= AUTO_MAX_ATTEMPTS
  if (gaveUp) patch.gave_up_at = now.toISOString()
  if (!after.steps.some((s) => s.state === 'missing')) patch.finished_at = now.toISOString()
  await db.from('request_automation_state').update(patch).eq('request_id', p.requestId)

  // a short internal note, so the ticket itself tells the story
  const lines = outcomes.map((o) => `- ${o.label}: ${plain[o.after]}${o.after === 'done' ? '' : ` (${o.detail})`}`)
  const head = p.mode === 'manual' ? `${p.actor?.name ?? 'An administrator'} ran the automation of this ticket again.` : 'The automatic retry ran the steps of this ticket that had not happened.'
  const tail = gaveUp ? '\nThe automatic retry has now tried 3 times and stops. An administrator can run it again from this ticket.' : ''
  await db.from('request_comments').insert({ request_id: p.requestId, author_id: actorId, is_internal: true, body: `${head}\n${lines.join('\n')}${tail}` })

  const failed = outcomes.filter((o) => o.after === 'missing' || o.after === 'blocked')
  return {
    ok: errors.length === 0,
    error: errors.length ? 'Part of it could not run. Please look at the ticket notes.' : undefined,
    message: failed.length === 0 ? 'Done. Every step that was missing has now happened.' : `Ran, but not everything could be done: ${failed.map((f) => `${f.label} (${f.detail})`).join('; ')}`,
    outcomes,
  }
}

// ── The 15-minute retry job ──

export type RetryResult = { looked: number; retried: number; fixed: number; gaveUp: number }

/** Called by the cron job "automation-retry": retries what is safe to retry on tickets made since this feature exists, newer than 3 days and older than 10 minutes. */
export async function runAutomationRetry(db: Db, now: Date = new Date()): Promise<RetryResult> {
  const out: RetryResult = { looked: 0, retried: 0, fixed: 0, gaveUp: 0 }
  const from = new Date(now.getTime() - 3 * 24 * 3600_000).toISOString()
  const to = new Date(now.getTime() - 10 * 60_000).toISOString()
  const waited = new Date(now.getTime() - AUTO_WAIT_MS).toISOString()
  const { data: rows } = await db.from('request_automation_state').select('request_id')
    .gte('started_at', from).lte('started_at', to).is('gave_up_at', null).lt('auto_attempts', AUTO_MAX_ATTEMPTS)
    .or(`auto_last_at.is.null,auto_last_at.lt.${waited}`).order('started_at', { ascending: true }).limit(300)
  const ids = ((rows ?? []) as { request_id: string }[]).map((r) => r.request_id)
  out.looked = ids.length
  if (ids.length === 0) return out
  const diagnoses = await diagnoseTickets(db, ids, { check: true }, now)
  let budget = 40
  for (const d of diagnoses) {
    if (!d.eligible) continue
    const todo = d.steps.some((s) => s.state === 'missing' && s.autoSafe)
    if (!todo) {
      if (!d.steps.some((s) => s.state === 'missing')) await markAutomationFinished(db, d.requestId)   // nothing left to do: remember it
      continue
    }
    if (budget-- <= 0) break
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
  const { count } = await db.from('request_automation_state').select('request_id', { count: 'exact', head: true }).gte('gave_up_at', new Date(now.getTime() - AUTO_WAIT_MS).toISOString())
  out.gaveUp = count ?? 0
  return out
}
