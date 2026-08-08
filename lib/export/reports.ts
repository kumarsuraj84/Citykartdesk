import { createAdminClient } from '@/lib/supabase/admin'
import { toCSV } from './csv'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

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
  const admin = createAdminClient() as unknown as AnyClient

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

  type RequestExportRow = {
    id: string; title: string; status: string; priority: string
    created_at: string; updated_at: string; resolution_due_at: string | null
    service: { name: string } | null
    requester: { full_name: string } | null
    assignee: { full_name: string } | null
    team: { name: string } | null
  }

  const rows = ((data ?? []) as RequestExportRow[]).map((r) => ({
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

export async function exportTasksCSV(orgId: string, f?: ExportFilters, teamIds?: string[]): Promise<string> {
  // Service-role client — apply org_id filter explicitly to keep the export tenant-scoped.
  const admin = createAdminClient() as unknown as AnyClient

  let query = admin
    .from('tasks')
    .select(
      'id,title,status,priority,due_date,created_at,updated_at,assignee:profiles!assignee_id(full_name),request:requests(title)'
    )
    .eq('org_id', orgId)

  // Non-admin/manager callers only export the team(s) they're on, not the whole org
  // (undefined = org-wide, an already-verified admin/manager caller).
  if (teamIds) query = query.in('team_id', teamIds)

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

  type TaskExportRow = {
    id: string; title: string; status: string; priority: string
    due_date: string | null; created_at: string; updated_at: string
    assignee: { full_name: string } | null
    request: { title: string } | null
  }

  const rows = ((data ?? []) as TaskExportRow[]).map((t) => ({
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

const PROJECT_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked:     'Blocked',
  done:        'Done',
  cancelled:   'Cancelled',
}

export async function exportProjectsCSV(orgId: string, teamIds?: string[]): Promise<string> {
  const admin = createAdminClient() as unknown as AnyClient

  let query = admin
    .from('projects')
    .select(
      'id,name,description,priority,status,start_date,target_date,owner:profiles!projects_owner_id_fkey(full_name),functional_owner:profiles!projects_functional_owner_id_fkey(full_name),team:teams(name)'
    )
    .eq('org_id', orgId)
    .is('archived_at', null)

  // Non-admin/manager callers only export the team(s) they're on, not the whole org
  // (undefined = org-wide, an already-verified admin/manager caller).
  if (teamIds) query = query.in('team_id', teamIds)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(MAX_EXPORT_ROWS + 1)

  if (error) throw new Error(error.message)

  if ((data ?? []).length > MAX_EXPORT_ROWS) {
    throw new Error(
      `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row limit. Please apply filters to narrow the result.`
    )
  }

  type ProjectExportRow = {
    id: string; name: string; description: string | null; priority: string; status: string
    start_date: string | null; target_date: string | null
    owner: { full_name: string } | null
    functional_owner: { full_name: string } | null
    team: { name: string } | null
  }

  const rows = ((data ?? []) as ProjectExportRow[]).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    priority: p.priority,
    tech_owner: p.owner?.full_name ?? '',
    functional_owner: p.functional_owner?.full_name ?? '',
    team: p.team?.name ?? '',
    status: PROJECT_STATUS_LABELS[p.status] ?? p.status,
    start_date: fmtDate(p.start_date),
    target_date: fmtDate(p.target_date),
  }))

  const columns = [
    { key: 'id',               label: 'ID' },
    { key: 'name',             label: 'Name' },
    { key: 'description',      label: 'Description' },
    { key: 'priority',         label: 'Priority' },
    { key: 'tech_owner',       label: 'Tech Owner' },
    { key: 'functional_owner', label: 'Functional Owner' },
    { key: 'team',             label: 'Team' },
    { key: 'status',           label: 'Status' },
    { key: 'start_date',       label: 'Start Date' },
    { key: 'target_date',      label: 'Target Date' },
  ]

  return toCSV(rows, columns)
}

// One row per approval, org-scoped via the related request (approvals has no org_id).
// Service-role client (needed by the scheduled-report path) so the org filter is explicit.
export async function exportApprovalsCSV(orgId: string, f?: ExportFilters): Promise<string> {
  const admin = createAdminClient() as unknown as AnyClient

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

  type DecisionRow = {
    approval_id: string
    step_order: number
    decision: string
    decided_at: string | null
    decider: { full_name: string | null } | null
  }
  type ApprovalExportRow = {
    id: string; status: string; current_step: number | null
    created_at: string; updated_at: string
    request: { request_no: string; title: string; org_id: string } | null
    workflow: { name: string } | null
  }

  // Fetch decisions for the selected approvals and summarise them per row.
  const ids = ((data ?? []) as ApprovalExportRow[]).map((a) => a.id)
  const { data: decisions } = ids.length
    ? await admin
        .from('approval_decisions')
        .select('approval_id,step_order,decision,decided_at,decider:profiles!approval_decisions_decided_by_fkey(full_name)')
        .in('approval_id', ids)
        .order('step_order', { ascending: true })
    : { data: [] as DecisionRow[] }

  const decisionsByApproval = new Map<string, DecisionRow[]>()
  for (const d of (decisions ?? []) as DecisionRow[]) {
    const list = decisionsByApproval.get(d.approval_id) ?? []
    list.push(d)
    decisionsByApproval.set(d.approval_id, list)
  }

  const rows = ((data ?? []) as ApprovalExportRow[]).map((a) => ({
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
