import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { getResolvedReopenWindowHours } from '@/lib/settings/reopenWindow'
import { issueCsat } from '@/lib/csat/issue'

// What a visit does to a ticket. Not a server action. The store (a plain requester) cannot move a ticket to Resolved on the status screen, so the confirmation of a
// visit resolves it here with the server's own key, after the caller has checked who may do it. The rules mirror applyStatusChange (lib/requests/status-change.ts):
// the reopen window, the SLA pause credit, the stopped timer, the activity entry, the survey and the notifications.

type Admin = ReturnType<typeof createAdminClient>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (a: Admin) => a as unknown as { from: (t: string) => any }

const RESOLVABLE = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho']

export type TicketRow = {
  id: string; request_no: string; title: string; status: string; requester_id: string; org_id: string; assigned_to: string | null
  waiting_since: string | null; response_due_at: string | null; resolution_due_at: string | null; paused_ms_total: number | null; reopen_count: number | null
}

const COLS = 'id, request_no, title, status, requester_id, org_id, assigned_to, waiting_since, response_due_at, resolution_due_at, paused_ms_total, reopen_count'

/** Moves one ticket to Resolved. Returns false when it was already resolved / closed / cancelled / waiting for an approval, or changed under our hands. */
export async function resolveTicketForVisit(admin: Admin, p: { requestId: string; actorId: string; actorName: string; via: 'store' | 'auto'; note: string }): Promise<boolean> {
  const db = loose(admin)
  const { data: req } = await db.from('requests').select(COLS).eq('id', p.requestId).maybeSingle()
  const r = req as TicketRow | null
  if (!r || !RESOLVABLE.includes(r.status)) return false

  const now = new Date()
  const nowIso = now.toISOString()
  const hours = await getResolvedReopenWindowHours()
  const patch: Record<string, unknown> = {
    status: 'resolved',
    resolved_at: nowIso,
    reopen_deadline_at: new Date(now.getTime() + hours * 3_600_000).toISOString(),
  }
  if ((r.status === 'waiting_user' || r.status === 'hold_purchase_ho') && r.waiting_since) {
    const paused = now.getTime() - new Date(r.waiting_since).getTime()
    if (r.response_due_at) patch.response_due_at = new Date(new Date(r.response_due_at).getTime() + paused).toISOString()
    if (r.resolution_due_at) patch.resolution_due_at = new Date(new Date(r.resolution_due_at).getTime() + paused).toISOString()
    patch.waiting_since = null
    patch.paused_ms_total = Number(r.paused_ms_total ?? 0) + paused
  }
  const { data: updated } = await db.from('requests').update(patch).eq('id', r.id).eq('status', r.status).select('id').maybeSingle()
  if (!updated) return false

  if (r.status === 'in_progress') await db.from('request_time_entries').update({ stopped_at: nowIso }).eq('request_id', r.id).is('stopped_at', null)

  await db.from('request_comments').insert({ request_id: r.id, author_id: p.actorId, body: p.note, is_internal: false })
  await logActivity({ requestId: r.id, actorId: p.actorId, action: 'status_changed', metadata: { from: r.status, to: 'resolved', via: p.via === 'store' ? 'store confirmed the visit' : 'automatic, the store did not object', remark: p.note } })

  let csatEmailed = false
  try {
    const csat = await issueCsat(admin as never, { id: r.id, requestNo: r.request_no, title: r.title, orgId: r.org_id, requesterId: r.requester_id }, {
      resolutionNote: p.note, resolverName: p.via === 'store' ? 'the store' : 'CK Desk', reopenDeadlineIso: patch.reopen_deadline_at as string, wasReopened: (r.reopen_count ?? 0) > 0, nowIso,
    })
    csatEmailed = csat.emailed
  } catch (e) {
    console.error('[visits] CSAT survey creation failed', e)
  }
  // The store is the requester and has just answered: it needs no message. An automatic resolution is told to the store, and the technician hears of either.
  if (p.via === 'auto') {
    notify({ recipientId: r.requester_id, actorId: p.actorId, type: 'request_resolved', title: 'Your request was resolved automatically', body: p.note, requestId: r.id, link: `/requests/${r.id}`, skipEmail: csatEmailed }).catch(() => {})
  }
  if (r.assigned_to && r.assigned_to !== p.actorId) {
    notify({ recipientId: r.assigned_to, actorId: p.actorId, type: 'status_changed', title: `${r.request_no} was resolved after the engineer's visit`, body: p.note, requestId: r.id, link: `/requests/${r.id}` }).catch(() => {})
  }
  return true
}

/** The engineer needs parts that Citykart must order: the ticket goes on hold for the purchase (the SLA pauses). Only from In Progress (or a ticket still open / assigned). */
export async function holdTicketForPurchase(admin: Admin, p: { requestId: string; actorId: string; note: string }): Promise<boolean> {
  const db = loose(admin)
  const { data: req } = await db.from('requests').select(COLS).eq('id', p.requestId).maybeSingle()
  const r = req as TicketRow | null
  if (!r || !['in_progress', 'open', 'assigned'].includes(r.status)) return false
  const nowIso = new Date().toISOString()
  const { data: updated } = await db.from('requests').update({ status: 'hold_purchase_ho', waiting_since: nowIso }).eq('id', r.id).eq('status', r.status).select('id').maybeSingle()
  if (!updated) return false
  if (r.status === 'in_progress') await db.from('request_time_entries').update({ stopped_at: nowIso }).eq('request_id', r.id).is('stopped_at', null)
  await logActivity({ requestId: r.id, actorId: p.actorId, action: 'status_changed', metadata: { from: r.status, to: 'hold_purchase_ho', via: 'engineer visit report: parts needed', remark: p.note } })
  return true
}

/** A ticket that was waiting for a purchase goes back to In Progress (a new visit report arrived, or the parts are in). SLA time is credited like the normal status change. */
export async function releaseTicketFromHold(admin: Admin, p: { requestId: string; actorId: string; note: string }): Promise<boolean> {
  const db = loose(admin)
  const { data: req } = await db.from('requests').select(COLS).eq('id', p.requestId).maybeSingle()
  const r = req as TicketRow | null
  if (!r || r.status !== 'hold_purchase_ho') return false
  const now = new Date()
  const patch: Record<string, unknown> = { status: 'in_progress', waiting_since: null }
  if (r.waiting_since) {
    const paused = now.getTime() - new Date(r.waiting_since).getTime()
    if (r.response_due_at) patch.response_due_at = new Date(new Date(r.response_due_at).getTime() + paused).toISOString()
    if (r.resolution_due_at) patch.resolution_due_at = new Date(new Date(r.resolution_due_at).getTime() + paused).toISOString()
    patch.paused_ms_total = Number(r.paused_ms_total ?? 0) + paused
  }
  const { data: updated } = await db.from('requests').update(patch).eq('id', r.id).eq('status', 'hold_purchase_ho').select('id').maybeSingle()
  if (!updated) return false
  await logActivity({ requestId: r.id, actorId: p.actorId, action: 'status_changed', metadata: { from: 'hold_purchase_ho', to: 'in_progress', via: 'engineer visit report', remark: p.note } })
  return true
}
