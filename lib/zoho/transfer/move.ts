import 'server-only'
/**
 * Moves Zoho tickets into CK Desk (stage 2). Written to be SILENT and SAFE:
 *  - no mail, no WhatsApp, no push, no notification, no survey: this file never calls any of them, and the Business Rules run in "quiet" mode;
 *  - the ticket keeps the Zoho number (`ZOHO-<number>`) and the Zoho created time; its SLA is counted from that time;
 *  - everything is re-read and re-checked here (the screen's preview is never trusted);
 *  - a ticket is CLAIMED first (the transfer list has one row per Zoho number), so it can never be moved twice, even by two people at once;
 *  - if anything fails after the claim, the half-made ticket is removed and the claim is released: a ticket is either moved completely or not at all;
 *  - Zoho is never written to.
 */
import fs from 'fs/promises'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { getZohoTicket } from '@/lib/zoho/queries'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { isSlaPausedStatus } from '@/lib/constants/requests'
import { generateOneTimePassword } from '@/lib/auth/one-time-password'
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@/lib/attachments/validate'
import { inspectBytes } from '@/lib/attachments/scan'
import { logger } from '@/lib/observability/logger'
import type { FormField } from '@/types'
import {
  loadCkCatalogue, loadMovedNumbers, loadPeopleDirectory, loadZohoExtras, STALE_CLAIM_MS, loadSavedMapping, loadTicketsForPreview, loadZohoMoveDetail, matchPerson, savedPeopleMap, toMappings,
  type CkPerson, type PeopleDirectory, type ZohoMoveDetail,
} from './data'
import { planTicket, type TicketPlan } from './plan'
import { approvalAction, approverEmail } from './approval'
import { coerceFieldValue, formDataEntry, type CoerceField } from './coerce'
import { isFinishedCkStatus } from './suggest'
import { ZOHO_UDF_LABELS, zohoUdfLabel } from './udf-labels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any; storage: any }
const db = () => createAdminClient() as unknown as AnyClient

/** "A handful": stage 2 moves a few tickets at a time, on purpose. */
export const MOVE_BATCH_LIMIT = 25

export type MoveResult = { zohoNo: number; ok: boolean; requestNo?: string; requestId?: string; reason?: string; notes: string[] }

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null)
const clipText = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const when = (v: string | null) => (v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'unknown time')

export async function moveZohoTickets(args: { orgId: string; actorId: string; numbers: number[] }): Promise<MoveResult[]> {
  const { orgId, actorId } = args
  const numbers = [...new Set(args.numbers.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MOVE_BATCH_LIMIT)
  if (numbers.length === 0) return []

  const [cat, saved] = await Promise.all([loadCkCatalogue(orgId), loadSavedMapping(orgId)])
  let dir = await loadPeopleDirectory(orgId)
  const maps = toMappings(saved)
  const services = new Map(cat.services.map((s) => [s.id, s]))
  const templates = new Map(cat.templates.map((t) => [t.id, { id: t.id, name: t.name }]))
  const created = new Map<string, CkPerson>() // inactive profiles made during this batch, so one person is made once

  const out: MoveResult[] = []
  for (const n of numbers) {
    try {
      out.push(await moveOne({ orgId, actorId, n, maps, services, templates, saved, getDir: () => dir, refreshDir: async () => { dir = await loadPeopleDirectory(orgId) }, created }))
    } catch (e) {
      logger.error({ event: 'zoho_transfer.move_failed', message: `Moving Zoho ticket ${n} failed unexpectedly`, route: 'lib/zoho/transfer/move.ts', orgId, errorCode: 'zoho_move_failed', context: { zohoNo: n }, error: e })
      out.push({ zohoNo: n, ok: false, reason: 'Something went wrong while moving this ticket. Nothing was kept.', notes: [] })
    }
  }
  return out
}

type Ctx = {
  orgId: string; actorId: string; n: number
  maps: ReturnType<typeof toMappings>
  services: Map<string, Awaited<ReturnType<typeof loadCkCatalogue>>['services'][number]>
  templates: Map<string, { id: string; name: string }>
  saved: Awaited<ReturnType<typeof loadSavedMapping>>
  getDir: () => PeopleDirectory
  refreshDir: () => Promise<void>
  created: Map<string, CkPerson>
}

async function moveOne(c: Ctx): Promise<MoveResult> {
  const { orgId, actorId, n } = c
  const d = db()
  const fail = (reason: string, notes: string[] = []): MoveResult => ({ zohoNo: n, ok: false, reason, notes })

  // 1. read the ticket again and work out the plan again
  const { rows } = await loadTicketsForPreview({ numbers: String(n) }, [])
  const ticket = rows.find((r) => r.displayId === n)
  if (!ticket) return fail('This Zoho ticket was not found.')
  const dir = c.getDir()
  const reqHand = savedPeopleMap(c.saved, 'requester', dir)
  const techHand = savedPeopleMap(c.saved, 'technician', dir)
  const reqMatch = matchPerson(dir, reqHand, { email: ticket.requesterEmail, name: ticket.requesterName })
  const techMatch = matchPerson(dir, techHand, { email: null, name: ticket.technicianName })
  const moved = await loadMovedNumbers(orgId, [n])
  const plan: TicketPlan = planTicket({ ticket, maps: c.maps, services: c.services, templates: c.templates, requester: reqMatch, technician: techMatch, alreadyMoved: moved.has(n) })
  if (!plan.ready || !plan.newNo || !plan.service || !plan.status || !plan.createdAt || !plan.priority) {
    return fail(plan.problems.map((p) => p.text).join(' ') || 'This ticket cannot be moved yet.')
  }
  const detail = await loadZohoMoveDetail(n)
  if (!detail) return fail('This Zoho ticket was not found.')

  // 2. claim the number (one row per Zoho ticket: a second try, or a second person, is refused here)
  const takeClaim = () => d.from('zoho_transfers').insert({ org_id: orgId, zoho_ticket_no: n, request_no: plan.newNo, state: 'moved', moved_by: actorId })
  let claim = await takeClaim()
  if (claim.error?.code === '23505') {
    // somebody holds it. If that claim is OLD and no ticket was ever made from it, the move that took it stopped half way (the server restarted): take it over.
    // A claim made a moment ago is a move still in progress, and is left alone.
    const { data: held } = await d.from('zoho_transfers').select('request_id, moved_at, state').eq('org_id', orgId).eq('zoho_ticket_no', n).maybeSingle()
    const { data: made } = await d.from('requests').select('id').eq('org_id', orgId).eq('request_no', plan.newNo).maybeSingle()
    const stale = !!held && held.state === 'moved' && held.request_id === null && !made && new Date().getTime() - new Date(held.moved_at).getTime() >= STALE_CLAIM_MS
    if (stale) {
      await d.from('zoho_transfers').delete().eq('org_id', orgId).eq('zoho_ticket_no', n).is('request_id', null).lt('moved_at', new Date(new Date().getTime() - STALE_CLAIM_MS).toISOString())
      claim = await takeClaim()
    } else if (held && held.state === 'moved' && held.request_id === null && !made) {
      return fail('This ticket is being moved right now by another move. Try again in a few minutes.')
    }
  }
  if (claim.error) return fail(claim.error.code === '23505' ? 'This ticket has already been moved to CK Desk.' : 'Could not reserve this ticket for the move.')

  let requestId: string | null = null
  try {
    const notes: string[] = []
    const done = await createEverything({ c, plan, ticket, detail, reqMatch, techPerson: techMatch.person ?? null, notes })
    requestId = done.requestId
    await d.from('zoho_transfers').update({ request_id: requestId }).eq('org_id', orgId).eq('zoho_ticket_no', n)
    return { zohoNo: n, ok: true, requestNo: plan.newNo, requestId, notes }
  } catch (e) {
    // all or nothing: remove whatever was made and release the claim
    if (requestId) await d.from('requests').delete().eq('id', requestId)
    else await removeByNumber(d, orgId, plan.newNo)
    await d.from('zoho_transfers').delete().eq('org_id', orgId).eq('zoho_ticket_no', n)
    logger.error({ event: 'zoho_transfer.move_rolled_back', message: `Zoho ticket ${n} was not moved: ${e instanceof Error ? e.message : 'unknown error'}`, route: 'lib/zoho/transfer/move.ts', orgId, errorCode: 'zoho_move_rolled_back', context: { zohoNo: n }, error: e })
    return fail(`Not moved: ${e instanceof Error ? e.message : 'something went wrong'}. Nothing was kept.`)
  }
}

async function removeByNumber(d: AnyClient, orgId: string, requestNo: string) {
  await d.from('requests').delete().eq('org_id', orgId).eq('request_no', requestNo)
}

async function createEverything(a: {
  c: Ctx; plan: TicketPlan; ticket: Awaited<ReturnType<typeof loadTicketsForPreview>>['rows'][number]; detail: ZohoMoveDetail
  reqMatch: ReturnType<typeof matchPerson>; techPerson: CkPerson | null; notes: string[]
}): Promise<{ requestId: string }> {
  const { c, plan, ticket, detail, notes } = a
  const { orgId, actorId } = c
  const d = db()

  // ── the service, its form and its SLA ─────────────────────────────────────────────────────────────────────────────────
  const { data: service } = await d.from('services').select('*, template:form_templates (form_sections), sla_policy:sla_policies (config)').eq('id', plan.service!.id).eq('org_id', orgId).maybeSingle()
  if (!service) throw new Error('the CK Desk service was not found')
  const sections = resolveServiceFormSections(service)
  const allFields = sections.flatMap((s) => s.fields) as FormField[]

  // ── the Zoho fields into the CK Desk form ────────────────────────────────────────────────────────────────────────────
  const formData: Record<string, unknown> = {}
  const unfit: string[] = []
  const fieldLabel = new Map((await loadZohoFieldLabels()).entries())
  for (const m of plan.mappedFields) {
    const field = allFields.find((f) => f.id === m.ckFieldId)
    if (!field) { unfit.push(`${fieldLabel.get(m.zohoField) ?? m.zohoField}: ${m.value} (the CK Desk field is not on the service's form)`); continue }
    const res = coerceFieldValue(field as unknown as CoerceField, m.value)
    if (res.ok) formData[field.id] = formDataEntry(field as unknown as CoerceField, res.value)
    else unfit.push(`${fieldLabel.get(m.zohoField) ?? m.zohoField}: ${m.value} (${res.reason})`)
  }
  const leftOut = plan.unmappedFields.map((k) => `${fieldLabel.get(k) ?? k}: ${ticket.fields[k]}`)
  if (unfit.length) notes.push(`${unfit.length} Zoho value(s) did not fit the CK Desk field and were kept in the Zoho note.`)

  // ── the requester ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const requesterId = a.reqMatch.person?.id ?? (await ensureInactiveRequester(c, ticket, notes))

  // ── times and status, as Zoho had them ───────────────────────────────────────────────────────────────────────────────
  const status = plan.status!
  const finished = isFinishedCkStatus(status)
  const createdAt = iso(plan.createdAt)!
  const resolvedAt = iso(ticket.resolvedAt) ?? iso(detail.completedAt)
  const times: Record<string, unknown> = { responded_at: iso(detail.respondedAt) }
  if (status === 'resolved') times.resolved_at = resolvedAt ?? createdAt
  if (status === 'closed') { times.closed_at = iso(detail.completedAt) ?? resolvedAt ?? createdAt; times.resolved_at = resolvedAt ?? times.closed_at }
  if (status === 'cancelled') times.cancellation_reason = 'manual'
  if (isSlaPausedStatus(status)) times.waiting_since = new Date().toISOString()
  // a finished ticket that Zoho never recorded a first response for cannot have been resolved without one: its response time is when it was finished (otherwise it would read "response overdue" forever)
  // a ticket Zoho already shows as being worked on (In Process, on hold, waiting) has been responded to: use the time of its first change after it was raised, so a technician who was
  // already working on it does not open it in CK Desk to find "response overdue" and a "Start Working" button for work that is already going on
  if (!finished && status !== 'open' && status !== 'pending_approval' && !times.responded_at) times.responded_at = iso(detail.history[1]?.at) ?? createdAt
  if (finished && !times.responded_at) times.responded_at = (times.closed_at ?? times.resolved_at ?? createdAt) as string

  const servicePolicy = service.sla_policy as { config: import('@/types').SLAConfig } | null
  const sla = await resolveSlaDeadlines(d as never, {
    serviceId: service.id, priority: plan.priority as 'low' | 'medium' | 'high' | 'urgent', servicePolicyConfig: servicePolicy?.config ?? null,
    allFields, formData, from: new Date(createdAt),
  })

  const { data: request, error } = await d.from('requests').insert({
    request_no: plan.newNo, service_id: service.id, category_id: plan.category?.id ?? null, sub_category_id: plan.subCategory?.id ?? null, team_id: service.team_id,
    requester_id: requesterId, org_id: orgId, title: clipText(ticket.subject ?? '(no subject)', 300), description: detail.message || null,
    priority: plan.priority, status, form_data: formData, form_schema_snapshot: service.form_fields, form_sections_snapshot: sections,
    response_due_at: sla.responseDueAt, resolution_due_at: sla.resolutionDueAt, created_at: createdAt, assigned_to: finished ? a.techPerson?.id ?? null : null,
    source_metadata: {
      created_via: 'zoho', zoho_ticket_no: plan.zohoNo, moved_at: new Date().toISOString(), moved_by: actorId,
      zoho: { template: plan.zoho.template, category: plan.zoho.category, subcategory: plan.zoho.subcategory, item: plan.zoho.item, status: plan.zoho.status, priority: plan.zoho.priority, technician: plan.zoho.technician, requester: plan.zoho.requester },
    },
    ...times,
  }).select('id, request_no').single()
  if (error || !request) throw new Error(`the ticket could not be created (${error?.message ?? 'unknown'})`)
  const requestId = request.id as string
  if (request.request_no !== plan.newNo) throw new Error(`the ticket number was not kept (got ${request.request_no}); is migration 197 applied?`)

  // ── automation state: written as "finished", so the 15-minute retry and "Run automation again" never send a mail for a moved ticket ────────────
  const now = new Date().toISOString()
  await d.from('request_automation_state').upsert({ request_id: requestId, org_id: orgId, expected_steps: { rules: true, vendor_mail: false, cvm: false }, started_at: now, rules_ran_at: now, finished_at: now, settled_at: now }, { onConflict: 'request_id' })

  // ── history of the ticket, as the Zoho story ──────────────────────────────────────────────────────────────────────────
  await d.from('request_activity').insert({ request_id: requestId, actor_id: actorId, action: 'created', metadata: { via: 'zoho_transfer', zoho_ticket_no: plan.zohoNo, zoho_status: plan.zoho.status }, created_at: createdAt })

  // ── the conversation: EVERYTHING Zoho held, with Zoho's own dates, times and people, so nobody has to open Zoho again ───────────────────────
  const comments: Record<string, unknown>[] = []
  const [full, extras] = await Promise.all([getZohoTicket(plan.zohoNo), loadZohoExtras(plan.zohoNo)])
  // a person named by Zoho becomes the CK Desk person who said / did it: the matched CK Desk person, else the one made inactive for them (never the person moving the ticket)
  const personCache = new Map<string, string>()
  const personId = async (name: string | null | undefined, emailHint?: string | null): Promise<string> => {
    const nm = (name ?? '').trim()
    if (!nm) return actorId
    const k = `${nm.toLowerCase()}|${(emailHint ?? '').toLowerCase()}`
    const cached = personCache.get(k)
    if (cached) return cached
    let id: string
    if (plan.zoho.requester && nm.toLowerCase() === plan.zoho.requester.toLowerCase()) id = requesterId
    else if (plan.zoho.technician && nm.toLowerCase() === plan.zoho.technician.toLowerCase() && a.techPerson) id = a.techPerson.id
    else {
      const hit = matchPerson(c.getDir(), new Map(), { email: emailHint ?? null, name: nm })
      id = hit.person?.id ?? (await ensureInactiveRequester(c, { requesterName: nm, requesterEmail: emailHint ?? null }, notes))
    }
    personCache.set(k, id)
    return id
  }
  const lines = [
    `MOVED FROM ZOHO — Zoho ticket ${plan.zohoNo}`,
    `Zoho service: ${[plan.zoho.template, plan.zoho.category, plan.zoho.subcategory, plan.zoho.item].filter(Boolean).join(' › ') || '—'}`,
    `Zoho status: ${plan.zoho.status ?? '—'}    Zoho priority: ${plan.zoho.priority ?? '—'}`,
    `Zoho technician: ${plan.zoho.technician ?? '—'}    Raised by: ${plan.zoho.requester ?? '—'}`,
  ]
  if (detail.closure) lines.push(`Closure: ${detail.closure.code}${detail.closure.comments ? ` — ${detail.closure.comments}` : ''}`)
  if (unfit.length) lines.push('', 'Zoho values that did not fit a CK Desk field (kept here):', ...unfit.map((u) => `  • ${u}`))
  if (leftOut.length) lines.push('', 'Zoho fields not mapped to a CK Desk field (kept here):', ...leftOut.map((u) => `  • ${u}`))
  comments.push({ request_id: requestId, author_id: actorId, body: clipText(lines.join('\n'), 20000), is_internal: true, source: 'portal', created_at: createdAt })

  // every field Zoho held on the ticket, in the same groups as the Zoho tab shows them
  if (full && full.groups.length) {
    const all = full.groups.flatMap((g) => ['', `— ${g.title} —`, ...g.fields.map((f) => `${f.label}: ${f.value}`)])
    comments.push({ request_id: requestId, author_id: actorId, body: clipText(`[Zoho — all the details Zoho held on this ticket]${all.join('\n')}`, 20000), is_internal: true, source: 'portal', created_at: new Date(new Date(createdAt).getTime() + 1).toISOString() })
  }

  for (const e of detail.emails) {
    const fromRequester = e.kind === 'REQREPLY'
    const email = /<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?/.exec(e.sender ?? '')?.[1] ?? null
    const body = `${e.subject ? `${e.subject}\n\n` : ''}${e.body}`.trim() || '(empty message)'
    const at = iso(e.at) ?? createdAt
    if (fromRequester) comments.push({ request_id: requestId, author_id: requesterId, external_name: email ? clipText(e.sender ?? email, 120) : null, external_email: email, body: clipText(body, 20000), is_internal: false, source: 'email', created_at: at })
    else comments.push({ request_id: requestId, author_id: null, external_name: clipText((e.sender ?? 'Zoho').replace(/<[^>]*>/g, '').trim() || 'Zoho', 120), external_email: email ?? 'zoho-helpdesk@example.test', body: clipText(`[Zoho e-mail sent by the system]\n${body}`, 20000), is_internal: true, source: 'email', created_at: at })
  }
  for (const nt of detail.notes) comments.push({ request_id: requestId, author_id: await personId(nt.who), body: clipText(`[Zoho note]\n${nt.body || '(empty note)'}`, 20000), is_internal: true, source: 'portal', created_at: iso(nt.at) ?? createdAt })
  for (const cv of extras.conversations) comments.push({ request_id: requestId, author_id: await personId(cv.who), body: clipText(`[Zoho conversation${cv.kind ? ` — ${cv.kind}` : ''}]\n${cv.text}`, 20000), is_internal: true, source: 'portal', created_at: iso(cv.at) ?? createdAt })
  for (const [i, t] of extras.tasks.entries()) comments.push({ request_id: requestId, author_id: await personId(t.who), body: clipText(`[Zoho task ${i + 1}]\n${t.text}`, 20000), is_internal: true, source: 'portal', created_at: iso(t.at) ?? createdAt })
  for (const [i, t] of extras.worklogs.entries()) comments.push({ request_id: requestId, author_id: await personId(t.who), body: clipText(`[Zoho work log ${i + 1}]\n${t.text}`, 20000), is_internal: true, source: 'portal', created_at: iso(t.at) ?? createdAt })
  if (detail.history.length) {
    const h = detail.history.map((x) => `${when(x.at)} — ${x.operation ?? 'change'}${x.who ? ` — ${x.who}` : ''}${x.body ? ` — ${clipText(x.body, 200)}` : ''}`)
    comments.push({ request_id: requestId, author_id: actorId, body: clipText(`[Zoho history]\n${h.join('\n')}`, 20000), is_internal: true, source: 'portal', created_at: iso(detail.history[0].at) ?? createdAt })
  }

  // approvals: each approval event Zoho recorded (sent for approval by the technician, approved / rejected by the approver) is written as its own entry with ITS Zoho time and
  // ITS person, and as a history entry of the ticket, so the whole approval can be read in CK Desk alone
  // Zoho writes an approval as several history lines: "approver_added" (who was named as approver, by whom), "req_approval" (the approval mail sent, by the technician), "approve" /
  // "reject" (the decision, by the approver, with "Approval Comments"), and "approval_status_change" (the system moving the status: that one is only kept in the history list).
  const approvalRe = /approv|reject|denied/i
  type ApprovalEvent = { at: string | null; who: string | null; whoEmail: string | null; what: string }
  const events: ApprovalEvent[] = detail.history
    .filter((x) => x.operation !== 'approval_status_change' && x.operation !== 'approval_reminder_sent' && approvalRe.test(`${x.operation ?? ''} ${x.body ?? ''}`))
    .map((x) => ({
      at: iso(x.at), who: x.who,
      // only for the decision itself ("Approved By : x@y") the address named is the person who did it; in "Approval mail sent to x@y" it is the person asked
      whoEmail: /^(approve|reject)/i.test(x.operation ?? '') ? approverEmail(x.body) : null,
      what: `${x.operation ?? 'approval'}${x.body ? ` — ${clipText(x.body, 600)}` : ''}`,
    }))
    .sort((p, q) => String(p.at ?? '').localeCompare(String(q.at ?? '')))
  const statusMeaningful = !!extras.approval && !/^(not required|none|n\/a|not applicable)$/i.test(extras.approval.trim())
  if (events.length === 0 && statusMeaningful) events.push({ at: null, who: plan.zoho.technician, whoEmail: null, what: `Approval status in Zoho: ${extras.approval}` })
  for (const ev of events) {
    const at = ev.at ?? createdAt
    const person = await personId(ev.who, ev.whoEmail)
    comments.push({ request_id: requestId, author_id: person, body: clipText(`[Zoho approval]\n${ev.what}${ev.who ? `\nBy: ${ev.who}` : ''}`, 20000), is_internal: false, source: 'portal', created_at: at })
    const action = approvalAction(ev.what)
    if (action) await d.from('request_activity').insert({ request_id: requestId, actor_id: person, action, metadata: { via: 'zoho_transfer', zoho_approval: ev.what, zoho_person: ev.who }, created_at: at })
  }
  if (events.length && statusMeaningful && !events.some((e) => /^approval status in zoho/i.test(e.what))) {
    comments.push({ request_id: requestId, author_id: actorId, body: `[Zoho approval]\nApproval status in Zoho: ${extras.approval}`, is_internal: false, source: 'portal', created_at: new Date(new Date(createdAt).getTime() + 2).toISOString() })
  }

  for (let i = 0; i < comments.length; i += 50) {
    const { error: ce } = await d.from('request_comments').insert(comments.slice(i, i + 50))
    if (ce) throw new Error(`the conversation could not be copied (${ce.message})`)
  }

  // ── attachments: copied when the Zoho files folder is configured and the file is there; otherwise listed so nothing is lost ───────────────────────
  if (detail.attachments.length) notes.push(...(await copyAttachments(c, requestId, createdAt, detail.attachments)))

  // ── the technician of an OPEN ticket: CK Desk's own Business Rules, quietly (nobody is told, the status stays as moved) ──────────────────────────
  if (!finished) {
    try {
      const { runRulesForTrigger } = await import('@/lib/rules/run')
      await runRulesForTrigger('created', requestId, { quiet: true })
    } catch (e) {
      notes.push('The Business Rules could not be run for this ticket; it was left unassigned.')
      logger.warn({ event: 'zoho_transfer.rules_failed', message: 'Quiet Business Rules failed for a moved ticket', route: 'lib/zoho/transfer/move.ts', requestId, orgId, error: e })
    }
  }
  return { requestId }
}

/** Zoho field key -> the plain name shown on the screens. */
export async function loadZohoFieldLabels(): Promise<Map<string, string>> {
  const { SERVICE_FIELDS } = await import('@/lib/zoho/queries')
  const m = new Map(SERVICE_FIELDS.map((f) => [f.col, f.label]))
  for (const k of Object.keys(ZOHO_UDF_LABELS)) m.set(`udf:${k}`, zohoUdfLabel(k))
  return m
}

/** A requester CK Desk has never seen becomes an INACTIVE profile (cannot sign in): the history stays correct and nobody is invited. */
async function ensureInactiveRequester(c: Ctx, ticket: { requesterName: string | null; requesterEmail: string | null }, notes: string[]): Promise<string> {
  const d = db()
  const name = (ticket.requesterName ?? '').trim() || (ticket.requesterEmail ?? '').split('@')[0] || 'Zoho requester'
  const key = (ticket.requesterEmail ?? '').trim().toLowerCase() || name.toLowerCase()
  const have = c.created.get(key)
  if (have) return have.id
  const email = (ticket.requesterEmail ?? '').trim().toLowerCase() || `zoho-moved-${key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Buffer.from(key).toString('hex').slice(0, 8)}@example.test`
  const { data, error } = await d.auth.admin.createUser({ email, password: generateOneTimePassword(24), email_confirm: true, user_metadata: { full_name: name, created_by: 'zoho_transfer' } })
  if (error || !data?.user?.id) throw new Error(`could not create the inactive profile for "${name}" (${error?.message ?? 'unknown'})`)
  const uid = data.user.id as string
  await d.auth.admin.updateUserById(uid, { ban_duration: '876000h' })
  const { error: pe } = await d.from('profiles').update({ role: 'user', full_name: name, org_id: c.orgId, is_active: false, must_reset_password: true, updated_at: new Date().toISOString() }).eq('id', uid)
  if (pe) throw new Error(`could not set up the inactive profile for "${name}" (${pe.message})`)
  c.created.set(key, { id: uid, name, email, active: false, role: 'user' })
  notes.push(`"${name}" was not in CK Desk: an inactive profile was created (it cannot sign in).`)
  // the new person is added to the list kept in memory for this batch (reading every sign-in account again after each one would be slow)
  const person = c.created.get(key)!
  const dir = c.getDir()
  dir.people.push(person)
  dir.byEmail.set(email, person)
  dir.byName.set(name.toLowerCase(), [...(dir.byName.get(name.toLowerCase()) ?? []), person])
  return uid
}

/** `later: true` = the ticket was moved earlier: the files and the note are stamped with today's time, not the ticket's. */
export async function copyAttachments(c: { actorId: string }, requestId: string, createdAt: string, atts: ZohoMoveDetail['attachments'], opts: { later?: boolean } = {}): Promise<string[]> {
  const d = db()
  const root = process.env.ZOHO_ATTACHMENTS_ROOT?.trim()
  const notes: string[] = []
  const notCopied: string[] = []
  let copied = 0
  for (const a of atts) {
    const ext = a.fileName.split('.').pop()?.toLowerCase() ?? ''
    try {
      if (!root || !a.ok || !a.storedFile) throw new Error(!root ? 'the Zoho files folder is not set up on this server' : 'Zoho did not keep this file')
      const full = path.resolve(root, a.storedFile)
      if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('the file path is outside the Zoho files folder')
      if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error('this kind of file is not allowed in CK Desk')
      const buf = await fs.readFile(full)
      if (buf.length > MAX_FILE_SIZE_BYTES) throw new Error('the file is larger than the CK Desk limit')
      const check = await inspectBytes(new Uint8Array(buf))
      if (!check.ok) throw new Error(check.code === 'macro' ? 'the file contains macros, which CK Desk does not accept' : check.error ?? 'the file did not pass the safety check')
      const safe = a.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')
      const storagePath = `${requestId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
      const up = await d.storage.from('request-attachments').upload(storagePath, buf, { contentType: a.contentType || 'application/octet-stream', upsert: false })
      if (up.error) throw new Error('the file could not be stored')
      const { error } = await d.from('request_attachments').insert({ request_id: requestId, uploaded_by: c.actorId, file_name: a.fileName, file_size: buf.length, mime_type: a.contentType || 'application/octet-stream', storage_path: storagePath, is_internal: false, uploaded_at: opts.later ? new Date().toISOString() : createdAt })
      if (error) { await d.storage.from('request-attachments').remove([storagePath]); throw new Error('the file could not be recorded') }
      copied++
    } catch (e) {
      notCopied.push(`${a.fileName} (${e instanceof Error ? e.message : 'not copied'})`)
    }
  }
  if (copied) notes.push(`${copied} attachment(s) copied.`)
  if (notCopied.length) {
    notes.push(`${notCopied.length} attachment(s) not copied (listed in the Zoho note).`)
    await d.from('request_comments').insert({ request_id: requestId, author_id: c.actorId, body: `${opts.later ? '[Zoho attachments added later — these were not copied]' : '[Zoho attachments not copied]'}\n${notCopied.map((x) => `  • ${x}`).join('\n')}`, is_internal: true, source: 'portal', created_at: opts.later ? new Date().toISOString() : new Date(new Date(createdAt).getTime() + 3).toISOString() })
  }
  return notes
}
