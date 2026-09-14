import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { applyCurrentlyBreachedFilter } from '@/lib/sla/breach'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type TaskTemplate = {
  id: string
  name: string
  description: string | null
  team_id: string | null
  created_at: string
  updated_at: string
  items?: TaskTemplateItem[]
}

export type TaskTemplateItem = {
  id: string
  template_id: string
  title: string
  description: string | null
  default_priority: 'low' | 'medium' | 'high' | 'urgent'
  due_offset_days: number | null
  position: number
}

export type TaskStatusRow = {
  id: string
  name: string
  value: string
  color: string
  display_order: number
  is_terminal: boolean
  is_active: boolean
  created_at: string
}

export type TaskPriorityRow = {
  id: string
  name: string
  value: string
  color: string
  display_order: number
  icon: string | null
  is_active: boolean
  created_at: string
}

export async function getTaskStatuses(): Promise<TaskStatusRow[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin
    .from('task_statuses')
    .select('*')
    .order('display_order', { ascending: true })
  return (data ?? []) as TaskStatusRow[]
}

export async function getTaskPriorities(): Promise<TaskPriorityRow[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin
    .from('task_priorities')
    .select('*')
    .order('display_order', { ascending: true })
  return (data ?? []) as TaskPriorityRow[]
}

export async function getTaskTemplates(teamId?: string): Promise<TaskTemplate[]> {
  const admin = (await createClient()) as unknown as AnyClient // RLS: org-scoped to caller
  let q = admin.from('task_templates').select('*').order('created_at', { ascending: false })
  if (teamId) q = q.eq('team_id', teamId)
  const { data } = await q
  return (data ?? []) as TaskTemplate[]
}

// ── Monitoring Stats ─────────────────────────────────────────────────────────

export type MonitoringStats = {
  open_requests: number
  open_tasks: number
  pending_approvals: number
  overdue_tasks: number
  sla_breached: number
  unassigned_requests: number
  requests_today: number
  resolved_today: number
  scheduled_reports_count: number
  business_rules_count: number
}

export type RecentActivityRow = {
  id: string
  action: string
  created_at: string
  actor_name: string
  request_id: string
  request_title: string | null
}

export async function getMonitoringStats(): Promise<MonitoringStats> {
  // Use the RLS-respecting client (NOT the service-role admin client) so every count is
  // automatically scoped to the caller's org. The /admin/monitoring page is reachable by
  // org-level `admin`, so a service-role client with no org filter leaked cross-org counts.
  const supabase = (await createClient()) as unknown as AnyClient

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = todayStart.toISOString()

  const closedStatuses = ['resolved', 'cancelled', 'closed']
  const doneCancelled = ['done', 'cancelled']

  const [
    openRequestsRes,
    openTasksRes,
    pendingApprovalsRes,
    overdueTasksRes,
    slaBreachedRes,
    unassignedRes,
    requestsTodayRes,
    resolvedTodayRes,
    scheduledReportsRes,
    businessRulesRes,
  ] = await Promise.all([
    supabase.from('requests').select('id', { count: 'exact', head: true }).not('status', 'in', `(${closedStatuses.join(',')})`),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).not('status', 'in', `(${doneCancelled.join(',')})`),
    supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).lt('due_date', new Date().toISOString()).not('status', 'in', `(${doneCancelled.join(',')})`),
    // "Currently Breached" (D-01, lib/sla/breach.ts) — same formula as the
    // Home Dashboard and Admin Analytics KPI card, not the Report Builder's
    // broader "Ever Breached" (which also counts tickets resolved late).
    applyCurrentlyBreachedFilter(supabase.from('requests').select('id', { count: 'exact', head: true })),
    supabase.from('requests').select('id', { count: 'exact', head: true }).is('assigned_to', null).not('status', 'in', `(${closedStatuses.join(',')})`),
    supabase.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
    supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'resolved').gte('updated_at', todayIso),
    supabase.from('scheduled_reports').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('business_rules').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ])

  return {
    open_requests: openRequestsRes.count ?? 0,
    open_tasks: openTasksRes.count ?? 0,
    pending_approvals: pendingApprovalsRes.count ?? 0,
    overdue_tasks: overdueTasksRes.count ?? 0,
    sla_breached: slaBreachedRes.count ?? 0,
    unassigned_requests: unassignedRes.count ?? 0,
    requests_today: requestsTodayRes.count ?? 0,
    resolved_today: resolvedTodayRes.count ?? 0,
    scheduled_reports_count: scheduledReportsRes.count ?? 0,
    business_rules_count: businessRulesRes.count ?? 0,
  }
}

export async function getRecentActivity(limit = 10): Promise<RecentActivityRow[]> {
  // RLS-respecting client: request_activity_select scopes rows to the caller's org via the
  // related request, so an org admin only sees their own org's activity.
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase
    .from('request_activity')
    .select('id, action, created_at, actor_id, request_id, profile:profiles!actor_id(full_name), request:requests(title)')
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row: {
    id: string
    action: string
    created_at: string
    request_id: string
    profile: { full_name: string } | null
    request: { title: string } | null
  }) => ({
    id: row.id,
    action: row.action,
    created_at: row.created_at,
    actor_name: row.profile?.full_name ?? 'Unknown',
    request_id: row.request_id,
    request_title: row.request?.title ?? null,
  }))
}

// ── Audit Logs ───────────────────────────────────────────────────────────────

export type AuditEntry = {
  id: string
  entity_type: 'request' | 'task' | 'service' | 'service_category' | 'service_sub_category'
  entity_id: string
  action: string
  actor_name: string
  metadata: Record<string, unknown>
  created_at: string
  entity_title?: string
}

const CATALOG_ENTITY_TYPES = ['service', 'service_category', 'service_sub_category'] as const

export async function getAuditLogs(opts: {
  page?: number
  perPage?: number
  actorId?: string
  entityType?: 'request' | 'task' | 'catalog' | 'all'
  dateFrom?: string
  dateTo?: string
}): Promise<{ data: AuditEntry[]; count: number }> {
  // RLS-respecting client: request_activity / task_activity / admin_audit_log SELECT
  // policies scope rows to the caller's org, so an org admin only sees their own org's
  // audit trail. (Was using the service-role client with no org filter — leaked cross-org
  // audit content.)
  const admin = (await createClient()) as unknown as AnyClient
  const page = Math.max(1, Math.trunc(opts.page ?? 1) || 1)
  const perPage = Math.min(200, Math.max(1, Math.trunc(opts.perPage ?? 50) || 50))
  const entityType = opts.entityType ?? 'all'

  // Bounded, not truly paginated at the SQL level (these are independently-sorted tables
  // merged in JS, so a page boundary can't be pushed into a single `.range()` on any one
  // of them) — but `.limit(page * perPage)` caps memory/transfer to the requested page
  // depth instead of the entire org's activity history, which is the actual risk.
  const rowCap = page * perPage

  const applyFilters = (q: ReturnType<AnyClient['from']>) => {
    if (opts.actorId) q = q.eq('actor_id', opts.actorId)
    if (opts.dateFrom) q = q.gte('created_at', opts.dateFrom)
    if (opts.dateTo) q = q.lte('created_at', opts.dateTo)
    return q.order('created_at', { ascending: false }).limit(rowCap)
  }

  const [rawRequests, rawTasks, rawAdmin] = await Promise.all([
    entityType === 'task' || entityType === 'catalog' ? Promise.resolve({ data: null }) : applyFilters(
      admin.from('request_activity').select(
        'id,request_id,action,actor_id,metadata,created_at,profile:profiles!actor_id(full_name),request:requests(title)'
      )
    ),
    entityType === 'request' || entityType === 'catalog' ? Promise.resolve({ data: null }) : applyFilters(
      admin.from('task_activity').select(
        'id,task_id,action,actor_id,metadata,created_at,profile:profiles!actor_id(full_name),task:tasks(title)'
      )
    ),
    entityType === 'request' || entityType === 'task' ? Promise.resolve({ data: null }) : applyFilters(
      admin.from('admin_audit_log').select(
        'id,entity_type,entity_id,action,actor_id,metadata,created_at,profile:profiles!actor_id(full_name)'
      )
    ),
  ])

  const requestEntries: AuditEntry[] = (rawRequests.data ?? []).map((row: {
    id: string; request_id: string; action: string
    metadata: Record<string, unknown>; created_at: string
    profile: { full_name: string } | null; request: { title: string } | null
  }) => ({
    id: row.id, entity_type: 'request' as const, entity_id: row.request_id,
    action: row.action, actor_name: row.profile?.full_name ?? 'Unknown',
    metadata: row.metadata ?? {}, created_at: row.created_at, entity_title: row.request?.title,
  }))

  const taskEntries: AuditEntry[] = (rawTasks.data ?? []).map((row: {
    id: string; task_id: string; action: string
    metadata: Record<string, unknown>; created_at: string
    profile: { full_name: string } | null; task: { title: string } | null
  }) => ({
    id: row.id, entity_type: 'task' as const, entity_id: row.task_id,
    action: row.action, actor_name: row.profile?.full_name ?? 'Unknown',
    metadata: row.metadata ?? {}, created_at: row.created_at, entity_title: row.task?.title,
  }))

  const adminEntries: AuditEntry[] = (rawAdmin.data ?? []).map((row: {
    id: string; entity_type: string; entity_id: string | null; action: string
    metadata: Record<string, unknown>; created_at: string
    profile: { full_name: string } | null
  }) => ({
    id: row.id,
    entity_type: (CATALOG_ENTITY_TYPES as readonly string[]).includes(row.entity_type)
      ? (row.entity_type as AuditEntry['entity_type'])
      : 'service',
    entity_id: row.entity_id ?? '',
    action: row.action, actor_name: row.profile?.full_name ?? 'Unknown',
    metadata: row.metadata ?? {}, created_at: row.created_at,
    entity_title: typeof row.metadata?.name === 'string' ? row.metadata.name : undefined,
  }))

  const merged = [...requestEntries, ...taskEntries, ...adminEntries].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const count = merged.length
  const start = (page - 1) * perPage
  const data = merged.slice(start, start + perPage)

  return { data, count }
}

// ── Approval Workflows ────────────────────────────────────────────────────────

export type ApprovalWorkflowSummary = {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  step_count: number
  services: { id: string; name: string; slug: string }[]
}

export type ApprovalWorkflowStep = {
  id: string
  workflow_id: string
  step_order: number
  approver_type: 'specific_user' | 'any_manager'
  approver_user_id: string | null
  approver?: { id: string; full_name: string } | null
}

export type ApprovalWorkflowWithSteps = ApprovalWorkflowSummary & {
  steps: ApprovalWorkflowStep[]
}

export async function getApprovalWorkflows(): Promise<ApprovalWorkflowSummary[]> {
  const admin = (await createClient()) as unknown as AnyClient // RLS: org-scoped to caller

  const { data: workflows } = await admin
    .from('approval_workflows')
    .select('id, name, description, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (!workflows?.length) return []

  const ids = workflows.map((w: { id: string }) => w.id)

  const [{ data: steps }, { data: services }] = await Promise.all([
    admin
      .from('approval_workflow_steps')
      .select('workflow_id')
      .in('workflow_id', ids),
    admin
      .from('services')
      .select('id, name, slug, approval_workflow_id')
      .in('approval_workflow_id', ids),
  ])

  return workflows.map((w: { id: string; name: string; description: string | null; created_at: string; updated_at: string }) => ({
    ...w,
    step_count: (steps ?? []).filter((s: { workflow_id: string }) => s.workflow_id === w.id).length,
    services: (services ?? [])
      .filter((s: { approval_workflow_id: string }) => s.approval_workflow_id === w.id)
      .map((s: { id: string; name: string; slug: string }) => ({ id: s.id, name: s.name, slug: s.slug })),
  }))
}

export async function getApprovalWorkflowWithSteps(id: string): Promise<ApprovalWorkflowWithSteps | null> {
  const admin = (await createClient()) as unknown as AnyClient // RLS: org-scoped to caller

  const { data: workflow } = await admin
    .from('approval_workflows')
    .select('id, name, description, created_at, updated_at')
    .eq('id', id)
    .single()

  if (!workflow) return null

  const [{ data: steps }, { data: services }] = await Promise.all([
    admin
      .from('approval_workflow_steps')
      .select('*, approver:profiles!approval_workflow_steps_approver_user_id_fkey(id, full_name)')
      .eq('workflow_id', id)
      .order('step_order', { ascending: true }),
    admin
      .from('services')
      .select('id, name, slug')
      .eq('approval_workflow_id', id),
  ])

  return {
    ...workflow,
    step_count: (steps ?? []).length,
    services: (services ?? []) as { id: string; name: string; slug: string }[],
    steps: (steps ?? []) as ApprovalWorkflowStep[],
  }
}
