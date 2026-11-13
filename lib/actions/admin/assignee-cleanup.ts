'use server'

// Tickets that are stuck with somebody who is no longer a technician (role changed, account switched off, account gone).
// Lists them, and "sends them back for routing": takes the technician off and lets the Business Rules give the ticket to the right technician again.
// The decision per status is in lib/requests/release-assignee.ts and is exactly what the ticket screen's own "unassign" does
// (a ticket that loses its owner while it is "assigned" or "in progress" goes back to "open"; a ticket that is waiting for the requester,
// an approval or a purchase keeps its status and is NOT routed automatically).

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logActivity } from '@/lib/activity'
import { recordAudit } from '@/lib/syslog/audit'
import { stopOpenTimeEntries } from '@/lib/requests/status-change'
import { runCreatedAssignRules } from '@/lib/automation/assign-rules'
import { OPEN_REQUEST_STATUSES } from '@/lib/constants/requests'
import { planRelease, whyCannotHoldTickets, canBeGivenTickets } from '@/lib/requests/release-assignee'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { inBatches } from '@/lib/queries/in-batches'
import type { RequestStatus } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any }

export type StuckAssigneeRow = {
  requestId: string
  requestNo: string | null
  title: string
  status: RequestStatus
  createdAt: string
  assigneeId: string
  assigneeName: string
  /** why that person must not hold tickets, as a plain sentence */
  reason: string
  /** what "send back for routing" would do to this ticket */
  willBeRouted: boolean
  warning?: string
}

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' as const }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' as const }
  return { profile }
}

/** Every unfinished ticket of this organisation whose technician may not hold tickets any more. */
export async function listTicketsWithoutRealTechnician(): Promise<{ error?: string; rows?: StuckAssigneeRow[] }> {
  const gate = await requireAdmin()
  if ('error' in gate) return { error: gate.error }
  const { profile } = gate
  const admin = createAdminClient() as unknown as AnyClient

  const { data: reqs, error } = await admin
    .from('requests')
    .select('id, request_no, title, status, created_at, assigned_to')
    .eq('org_id', profile.org_id)
    .not('assigned_to', 'is', null)
    .in('status', OPEN_REQUEST_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/assignee-cleanup.ts' }) }

  const rows = (reqs ?? []) as { id: string; request_no: string | null; title: string; status: RequestStatus; created_at: string; assigned_to: string }[]
  if (rows.length === 0) return { rows: [] }

  type Person = { id: string; full_name: string | null; role: string | null; is_active: boolean | null; vendor_company_id: string | null }
  const { data: peopleRows } = await inBatches<Person>(
    rows.map((r) => r.assigned_to),
    (batch) => admin.from('profiles').select('id, full_name, role, is_active, vendor_company_id').in('id', batch).eq('org_id', profile.org_id),
  )
  const people = new Map<string, Person>(peopleRows.map((p) => [p.id, p]))

  const out: StuckAssigneeRow[] = []
  for (const r of rows) {
    const p = people.get(r.assigned_to) ?? null
    const reason = whyCannotHoldTickets(p)
    if (!reason) continue
    const decision = planRelease(r.status, true)
    if (decision.action === 'skip') continue
    out.push({
      requestId: r.id,
      requestNo: r.request_no,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      assigneeId: r.assigned_to,
      assigneeName: p?.full_name ?? 'account no longer exists',
      reason,
      willBeRouted: decision.action !== 'clear_keep_status',
      warning: decision.warning,
    })
  }
  return { rows: out }
}

export type ReleaseOutcome = {
  released: number
  routed: number
  keptWaiting: number
  skipped: number
  /** one plain sentence per ticket that needs attention */
  notes: string[]
}

/** Takes the technician off these tickets and lets the Business Rules route them again. Only tickets of the caller's organisation are touched. */
export async function releaseRequests(requestIds: string[]): Promise<{ error?: string; data?: ReleaseOutcome }> {
  const gate = await requireAdmin()
  if ('error' in gate) return { error: gate.error }
  const { profile } = gate
  if (!Array.isArray(requestIds) || requestIds.length === 0) return { error: 'No tickets were chosen.' }
  if (requestIds.length > 500) return { error: 'Too many tickets at once; choose at most 500.' }

  const admin = createAdminClient() as unknown as AnyClient
  const out: ReleaseOutcome = { released: 0, routed: 0, keptWaiting: 0, skipped: 0, notes: [] }

  for (const id of requestIds) {
    const { data: r } = await admin.from('requests').select('id, request_no, status, assigned_to').eq('id', id).eq('org_id', profile.org_id).maybeSingle()
    if (!r) { out.skipped++; continue }
    const label = r.request_no ?? id.slice(0, 8)
    const decision = planRelease(r.status, !!r.assigned_to)
    if (decision.action === 'skip') { out.skipped++; out.notes.push(`${label}: not changed - ${decision.skipReason}`); continue }

    // the same two guards the ticket screen uses, so a ticket somebody else just changed is never overwritten
    const { data: updated } = await admin.from('requests')
      .update({ assigned_to: null, status: decision.newStatus })
      .eq('id', r.id).eq('assigned_to', r.assigned_to).eq('status', r.status)
      .select('id').maybeSingle()
    if (!updated) { out.skipped++; out.notes.push(`${label}: not changed - somebody else changed it a moment ago.`); continue }

    await stopOpenTimeEntries(r.id, new Date().toISOString(), r.assigned_to)
    await logActivity({ requestId: r.id, actorId: profile.id, action: 'unassigned', metadata: { reason: 'the technician may no longer hold tickets', previous_assignee: r.assigned_to } })
    out.released++

    if (decision.action === 'clear_keep_status') { out.keptWaiting++; if (decision.warning) out.notes.push(`${label}: ${decision.warning}`); continue }
    try {
      // `ran` only means the assign actions of a matching rule were carried out - a rule can send a ticket to a technician GROUP without naming a person,
      // so the ticket is only really routed when somebody holds it afterwards. Read the ticket again instead of trusting `ran`.
      await runCreatedAssignRules(r.id)
      const { data: after } = await admin.from('requests').select('assigned_to').eq('id', r.id).maybeSingle()
      if (after?.assigned_to) out.routed++
      else out.notes.push(`${label}: no Business Rule gave it to a technician, so it is waiting in the unassigned list.`)
    } catch (e) {
      out.notes.push(`${label}: the technician was taken off, but the Business Rules could not run (${e instanceof Error ? e.message : 'unknown error'}). It is in the unassigned list.`)
    }
  }

  await recordAudit({
    action: 'request.assignee_released', entityType: 'request',
    message: `${out.released} ticket(s) taken off a person who may not hold tickets; ${out.routed} routed again`,
    after: { ...out, notes: out.notes.length }, actorId: profile.id, orgId: profile.org_id,
  })
  revalidatePath('/admin/stuck-tickets')
  revalidatePath('/requests')
  return { data: out }
}

/** Hands these tickets to one chosen technician (used when an administrator would rather name a person than let the rules decide). */
export async function reassignRequests(requestIds: string[], toUserId: string): Promise<{ error?: string; data?: { moved: number; skipped: number; notes: string[] } }> {
  const gate = await requireAdmin()
  if ('error' in gate) return { error: gate.error }
  const { profile } = gate
  if (!Array.isArray(requestIds) || requestIds.length === 0) return { error: 'No tickets were chosen.' }
  if (requestIds.length > 500) return { error: 'Too many tickets at once; choose at most 500.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: target } = await admin.from('profiles').select('id, full_name, role, is_active, org_id').eq('id', toUserId).maybeSingle()
  if (!target || target.org_id !== profile.org_id || !canBeGivenTickets(target)) {
    return { error: 'A ticket can only be given to an active technician or manager of this organisation.' }
  }

  const out = { moved: 0, skipped: 0, notes: [] as string[] }
  for (const id of requestIds) {
    const { data: r } = await admin.from('requests').select('id, request_no, status, assigned_to, team_id').eq('id', id).eq('org_id', profile.org_id).maybeSingle()
    if (!r) { out.skipped++; continue }
    const label = r.request_no ?? id.slice(0, 8)
    if (planRelease(r.status, !!r.assigned_to).action === 'skip') { out.skipped++; out.notes.push(`${label}: not changed - the ticket is already finished.`); continue }
    // a plain technician can only see a ticket of their own group (row security follows the group), so giving it to somebody outside the group would hide it
    if (target.role === 'agent') {
      const { count } = await admin.from('team_members').select('user_id', { count: 'exact', head: true }).eq('team_id', r.team_id).eq('user_id', toUserId)
      if (!count) { out.skipped++; out.notes.push(`${label}: not changed - ${target.full_name} is not in the technician group of this ticket and could not open it.`); continue }
    }
    const newStatus: RequestStatus = r.status === 'open' ? ('assigned' as RequestStatus) : (r.status as RequestStatus)
    const { data: updated } = await admin.from('requests')
      .update({ assigned_to: toUserId, status: newStatus })
      .eq('id', r.id).eq('assigned_to', r.assigned_to).eq('status', r.status)
      .select('id').maybeSingle()
    if (!updated) { out.skipped++; out.notes.push(`${label}: not changed - somebody else changed it a moment ago.`); continue }
    if (r.assigned_to && r.assigned_to !== toUserId) await stopOpenTimeEntries(r.id, new Date().toISOString(), r.assigned_to)
    await logActivity({ requestId: r.id, actorId: profile.id, action: 'assigned', metadata: { assigned_to: toUserId, previous_assignee: r.assigned_to } })
    out.moved++
  }

  await recordAudit({
    action: 'request.assignee_moved', entityType: 'request',
    message: `${out.moved} ticket(s) given to ${target.full_name}`,
    after: { moved: out.moved, skipped: out.skipped, to: toUserId }, actorId: profile.id, orgId: profile.org_id,
  })
  revalidatePath('/admin/stuck-tickets')
  revalidatePath('/requests')
  return { data: out }
}

/** The unfinished tickets this person is holding right now (for the question asked before their role is changed or their account switched off). */
export async function countTicketsHeldBy(userId: string): Promise<{ error?: string; count?: number; requestNos?: string[]; requestIds?: string[] }> {
  const gate = await requireAdmin()
  if ('error' in gate) return { error: gate.error }
  const { profile } = gate
  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin.from('requests').select('id, request_no').eq('org_id', profile.org_id).eq('assigned_to', userId)
    .in('status', OPEN_REQUEST_STATUSES as unknown as string[]).order('created_at', { ascending: false })
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/assignee-cleanup.ts' }) }
  const rows = (data ?? []) as { id: string; request_no: string | null }[]
  return {
    count: rows.length,
    requestNos: rows.map((r) => r.request_no).filter(Boolean).slice(0, 20) as string[],
    requestIds: rows.map((r) => r.id),
  }
}
