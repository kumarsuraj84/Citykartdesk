import { createAdminClient } from '@/lib/supabase/admin'
import { toCSV } from './csv'

export const MAX_EXPORT_ROWS = 10000

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  pending_approval: 'Pending Approval',
  on_hold: 'On Hold',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  todo: 'To Do',
  done: 'Done',
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function labelStatus(v: string | null | undefined): string {
  if (!v) return ''
  return STATUS_LABELS[v] ?? v
}

function labelPriority(v: string | null | undefined): string {
  if (!v) return ''
  return PRIORITY_LABELS[v] ?? v
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return ''
  try {
    return new Date(v).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return v
  }
}

export interface ExportFilters {
  status?: string
  priority?: string
  assignee_id?: string
  date_from?: string
  date_to?: string
  teamId?: string
}

export async function exportRequestsCSV(orgId: string, f?: ExportFilters): Promise<string> {
  // Service-role client (needed so this also works from the scheduled-report path) — so the
  // org_id filter MUST be applied explicitly to keep the export scoped to one tenant.
  const admin = createAdminClient() as unknown as any

  let query = admin
    .from('requests')
    .select(
      'id,title,status,priority,created_at,updated_at,resolution_due_at,service:services(name),requester:profiles!requester_id(full_name),assignee:profiles!assigned_to(full_name),team:teams(name)'
    )
    .eq('org_id', orgId)

  if (f?.status)      query = query.eq('status', f.status)
  if (f?.priority)    query = query.eq('priority', f.priority)
  if (f?.assignee_id) query = query.eq('assigned_to', f.assignee_id)
  if (f?.teamId)      query = query.eq('team_id', f.teamId)
  if (f?.date_from)   query = query.gte('created_at', f.date_from)
  if (f?.date_to)     query = query.lte('created_at', f.date_to)

  // Fetch one extra to detect overflow
  query = query.limit(MAX_EXPORT_ROWS + 1)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  if ((data ?? []).length > MAX_EXPORT_ROWS) {
    throw new Error(
      `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row limit. Please apply filters to narrow the result.`
    )
  }

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    status: labelStatus(r.status),
    priority: labelPriority(r.priority),
    service: r.service?.name ?? '',
    team: r.team?.name ?? '',
    requester: r.requester?.full_name ?? '',
    assignee: r.assignee?.full_name ?? '',
    created_at: fmtDate(r.created_at),
    updated_at: fmtDate(r.updated_at),
    sla_deadline: fmtDate(r.resolution_due_at),
  }))

  const columns = [
    { key: 'id',           label: 'ID' },
    { key: 'title',        label: 'Title' },
    { key: 'status',       label: 'Status' },
    { key: 'priority',     label: 'Priority' },
    { key: 'service',      label: 'Service' },
    { key: 'team',         label: 'Team' },
    { key: 'requester',    label: 'Requester' },
    { key: 'assignee',     label: 'Assignee' },
    { key: 'created_at',   label: 'Created' },
    { key: 'updated_at',   label: 'Updated' },
    { key: 'sla_deadline', label: 'SLA Deadline' },
  ]

  return toCSV(rows, columns)
}

export async function exportTasksCSV(orgId: string, f?: ExportFilters): Promise<string> {
  // Service-role client — apply org_id filter explicitly to keep the export tenant-scoped.
  const admin = createAdminClient() as unknown as any

  let query = admin
    .from('tasks')
    .select(
      'id,title,status,priority,due_date,created_at,updated_at,assignee:profiles!assignee_id(full_name),request:requests(title)'
    )
    .eq('org_id', orgId)

  if (f?.status)      query = query.eq('status', f.status)
  if (f?.priority)    query = query.eq('priority', f.priority)
  if (f?.assignee_id) query = query.eq('assignee_id', f.assignee_id)
  if (f?.date_from)   query = query.gte('created_at', f.date_from)
  if (f?.date_to)     query = query.lte('created_at', f.date_to)

  query = query.limit(MAX_EXPORT_ROWS + 1)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  if ((data ?? []).length > MAX_EXPORT_ROWS) {
    throw new Error(
      `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row limit. Please apply filters to narrow the result.`
    )
  }

  const rows = (data ?? []).map((t: any) => ({
    id: t.id,
    title: t.title,
    status: labelStatus(t.status),
    priority: labelPriority(t.priority),
    assignee: t.assignee?.full_name ?? '',
    due_date: fmtDate(t.due_date),
    linked_request: t.request?.title ?? '',
    created_at: fmtDate(t.created_at),
    updated_at: fmtDate(t.updated_at),
  }))

  const columns = [
    { key: 'id',             label: 'ID' },
    { key: 'title',          label: 'Title' },
    { key: 'status',         label: 'Status' },
    { key: 'priority',       label: 'Priority' },
    { key: 'assignee',       label: 'Assigned To' },
    { key: 'due_date',       label: 'Due Date' },
    { key: 'linked_request', label: 'Linked Request' },
    { key: 'created_at',     label: 'Created' },
    { key: 'updated_at',     label: 'Updated' },
  ]

  return toCSV(rows, columns)
}

// One row per approval, org-scoped via the related request (approvals has no org_id).
// Service-role client (needed by the scheduled-report path) so the org filter is explicit.
export async function exportApprovalsCSV(orgId: string, f?: ExportFilters): Promise<string> {
  const admin = createAdminClient() as unknown as any

  let query = admin
    .from('approvals')
    .select(
      'id,status,current_step,created_at,updated_at,request:requests!inner(request_no,title,org_id),workflow:approval_workflows(name)'
    )
    .eq('request.org_id', orgId)

  if (f?.status)    query = query.eq('status', f.status)
  if (f?.date_from) query = query.gte('created_at', f.date_from)
  if (f?.date_to)   query = query.lte('created_at', f.date_to)

  query = query.limit(MAX_EXPORT_ROWS + 1)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  if ((data ?? []).length > MAX_EXPORT_ROWS) {
    throw new Error(
      `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row limit. Please apply filters to narrow the result.`
    )
  }

  // Fetch decisions for the selected approvals and summarise them per row.
  const ids = (data ?? []).map((a: any) => a.id)
  const { data: decisions } = ids.length
    ? await admin
        .from('approval_decisions')
        .select('approval_id,step_order,decision,decided_at,decider:profiles!approval_decisions_decided_by_fkey(full_name)')
        .in('approval_id', ids)
        .order('step_order', { ascending: true })
    : { data: [] }

  const decisionsByApproval = new Map<string, any[]>()
  for (const d of decisions ?? []) {
    const list = decisionsByApproval.get(d.approval_id) ?? []
    list.push(d)
    decisionsByApproval.set(d.approval_id, list)
  }

  const rows = (data ?? []).map((a: any) => ({
    request: a.request ? `${a.request.request_no} — ${a.request.title}` : '',
    workflow: a.workflow?.name ?? '',
    status: labelStatus(a.status),
    current_step: a.current_step ?? '',
    decisions: (decisionsByApproval.get(a.id) ?? [])
      .map((d) => `${d.decider?.full_name ?? 'Unknown'}: ${labelStatus(d.decision)} (step ${d.step_order})`)
      .join('; '),
    created_at: fmtDate(a.created_at),
    updated_at: fmtDate(a.updated_at),
  }))

  const columns = [
    { key: 'request',      label: 'Request' },
    { key: 'workflow',     label: 'Workflow' },
    { key: 'status',       label: 'Status' },
    { key: 'current_step', label: 'Current Step' },
    { key: 'decisions',    label: 'Decisions' },
    { key: 'created_at',   label: 'Created' },
    { key: 'updated_at',   label: 'Updated' },
  ]

  return toCSV(rows, columns)
}
