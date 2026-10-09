'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { resolveReportAccess } from '@/lib/reporting/access'
import { applyScope, oemBrand } from '@/lib/queries/executive-dashboard'
import { statusLabel } from '@/lib/reporting/executive/engine'
import { nudgeRequest, NUDGEABLE_STATUSES } from '@/lib/requests/nudge'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export interface ExecTicketEvent {
  at: number
  label: string
  by: string
  note: string
}

/** Everything the dashboard's "one ticket" view shows. Times are epoch milliseconds. */
export interface ExecTicketDetail {
  id: string
  no: string
  subject: string
  description: string
  status: string
  priority: string
  group: string
  technician: string
  requester: string
  department: string
  store: string
  oem: string
  brand: string
  service: string
  category: string
  subCategory: string
  created: number
  responded: number | null
  resolved: number | null
  resolutionDue: number | null
  responseDue: number | null
  reopenCount: number
  csat: { rating: number | null; comment: string } | null
  /** how the ticket was raised (Portal, Email, WhatsApp ...) */
  source: string
  storeState: string
  closed: number | null
  /** first time the ticket was handed to a technician */
  assignedAt: number | null
  approval: { status: 'pending' | 'approved' | 'rejected'; requested: number; decided: number | null; by: string } | null
  events: ExecTicketEvent[]
  /** the viewer may send the handling technician a reminder (not a requester; the ticket is waiting on a technician) */
  canNudge: boolean
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

function describe(action: string, meta: Record<string, unknown>): { label: string; note: string } {
  switch (action) {
    case 'created': return { label: 'Ticket raised', note: '' }
    case 'assigned': return { label: meta.assigned_to ? 'Assigned to a technician' : 'Assignment cleared', note: str(meta.reason) }
    case 'unassigned': return { label: 'Un-assigned', note: str(meta.reason) }
    case 'status_changed': return { label: `Status: ${statusLabel(str(meta.from))} → ${statusLabel(str(meta.to))}`, note: str(meta.remark) }
    case 'priority_changed': return { label: `Priority: ${str(meta.priority_from)} → ${str(meta.priority_to)}`, note: '' }
    case 'resolved': return { label: 'Resolved', note: str(meta.remark) }
    case 'closed': return { label: 'Closed', note: '' }
    case 'reopened': return { label: 'Re-opened', note: str(meta.reason) }
    case 'cancelled': return { label: 'Cancelled', note: '' }
    case 'approval_requested': return { label: 'Approval requested', note: '' }
    case 'approved': return { label: 'Approved', note: '' }
    case 'rejected': return { label: 'Rejected', note: '' }
    case 'comment_added': return { label: 'Comment added', note: '' }
    case 'attachment_added': return { label: 'Attachment added', note: '' }
    case 'reclassified': return { label: 'Category changed', note: '' }
    default: return { label: action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), note: '' }
  }
}

/** One ticket for the dashboard popup — only if it is inside the viewer's own level. */
export async function getExecutiveTicketDetail(id: string): Promise<{ error: string } | { detail: ExecTicketDetail }> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  const access = resolveReportAccess(profile, 'requests')
  if ('error' in access) return { error: access.error }

  const admin = createAdminClient() as unknown as AnyClient
  const select = [
    'id, request_no, title, description, status, priority, created_at, resolved_at, closed_at, responded_at, resolution_due_at, response_due_at, reopen_count',
    'team:teams(name)',
    'assignee:profiles!requests_assigned_to_fkey(full_name)',
    'requester:profiles!requests_requester_id_fkey(full_name, department:departments!profiles_department_id_fkey(name), store:stores(name, state, oem:oems(name)))',
    'source_metadata',
    'service:services(name, auto_oem_routing)',
    'category:service_categories(name)',
    'sub_category:service_sub_categories(name)',
    'csat:csat_surveys(rating, comment)',
  ].join(', ')
  const { data } = await applyScope(
    admin.from('requests').select(select).eq('org_id', profile.org_id).eq('id', id), access.scope, ''
  ).maybeSingle()
  if (!data) return { error: 'This ticket is not available to you.' }

  const { data: acts } = await admin
    .from('request_activity')
    .select('action, created_at, metadata, actor:profiles!request_activity_actor_id_fkey(full_name)')
    .eq('request_id', id).order('created_at', { ascending: true }).limit(60)

  const { data: apData } = await admin
    .from('approvals')
    .select('status, created_at, decisions:approval_decisions(decided_at, decider:profiles!approval_decisions_decided_by_fkey(full_name))')
    .eq('request_id', id).order('created_at', { ascending: false }).limit(1)
  const ap = (apData ?? [])[0] as { status: string; created_at: string; decisions: { decided_at: string; decider: { full_name: string } | null }[] | null } | undefined
  const lastDecision = ap ? [...(ap.decisions ?? [])].sort((x, y) => new Date(x.decided_at).getTime() - new Date(y.decided_at).getTime()).pop() : undefined
  const approval: ExecTicketDetail['approval'] = ap && (ap.status === 'pending' || ap.status === 'approved' || ap.status === 'rejected')
    ? { status: ap.status, requested: new Date(ap.created_at).getTime(), decided: ap.status === 'pending' ? null : lastDecision ? new Date(lastDecision.decided_at).getTime() : new Date(ap.created_at).getTime(), by: lastDecision?.decider?.full_name ?? '' }
    : null
  const activity = (acts ?? []) as { action: string; created_at: string; metadata: Record<string, unknown> | null; actor: { full_name: string } | null }[]
  const firstAssigned = activity.find((a) => a.action === 'assigned' && a.metadata?.assigned_to)
  const via = (data.source_metadata as { created_via?: string } | null)?.created_via
  // same rule as the dashboard: the store's OEM belongs only to equipment (OEM-routed) services
  const oem: string = data.service?.auto_oem_routing ? (data.requester?.store?.oem?.name ?? '') : ''
  const surveyRaw = data.csat as { rating: number | null; comment: string | null } | { rating: number | null; comment: string | null }[] | null
  const survey = Array.isArray(surveyRaw) ? surveyRaw[0] : surveyRaw ?? undefined
  const detail: ExecTicketDetail = {
    id: data.id,
    no: data.request_no,
    subject: data.title,
    description: str(data.description).slice(0, 800),
    status: data.status,
    priority: data.priority,
    group: data.team?.name ?? '',
    technician: data.assignee?.full_name ?? 'Unassigned',
    requester: data.requester?.full_name ?? '',
    department: data.requester?.department?.name ?? '',
    store: data.requester?.store?.name ?? '',
    oem,
    brand: oem ? oemBrand(oem) : '',
    service: data.service?.name ?? '',
    category: data.category?.name ?? '',
    subCategory: data.sub_category?.name ?? '',
    created: new Date(data.created_at).getTime(),
    responded: ms(data.responded_at),
    resolved: ms(data.resolved_at ?? data.closed_at),
    resolutionDue: ms(data.resolution_due_at),
    responseDue: ms(data.response_due_at),
    reopenCount: data.reopen_count ?? 0,
    csat: survey && survey.rating !== null ? { rating: survey.rating, comment: survey.comment ?? '' } : null,
    source: via ? via.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Portal',
    storeState: data.requester?.store?.state ?? '',
    closed: ms(data.closed_at),
    assignedAt: firstAssigned ? new Date(firstAssigned.created_at).getTime() : null,
    approval,
    events: activity.map((a) => {
      const d = describe(a.action, a.metadata ?? {})
      return { at: new Date(a.created_at).getTime(), label: d.label, by: a.actor?.full_name ?? 'System', note: d.note }
    }),
    canNudge: profile.role !== 'user' && (NUDGEABLE_STATUSES as readonly string[]).includes(data.status),
  }
  return { detail }
}

/** Sends the technician handling a ticket (or the group leads, if nobody has it yet) a reminder. Once per ticket every few hours. */
export async function nudgeTicket(id: string, message: string): Promise<{ error: string } | { sent: number; names: string[] }> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id) return { error: 'Unauthorized.' }
  // Requesters see their own tickets here but never hurry the technician from the dashboard.
  if (profile.role === 'user') return { error: "You don't have permission to nudge." }
  const access = resolveReportAccess(profile, 'requests')
  if ('error' in access) return { error: access.error }

  const admin = createAdminClient() as unknown as AnyClient
  // the viewer must be able to see this ticket in their own level
  const { data: visible } = await applyScope(admin.from('requests').select('id').eq('org_id', profile.org_id).eq('id', id), access.scope, '').maybeSingle()
  if (!visible) return { error: 'This ticket is not available to you.' }

  return nudgeRequest(admin, { requestId: id, orgId: profile.org_id, actorId: profile.id, actorName: profile.full_name, message })
}
