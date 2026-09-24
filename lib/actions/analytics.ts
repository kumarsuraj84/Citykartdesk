'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeReportAccess } from '@/lib/reporting/access'
import { resolvePeriodParam, type PeriodParam } from '@/lib/queries/analytics'
import { applyCurrentlyBreachedFilter } from '@/lib/sla/breach'
import type { Database } from '@/types/database'
import type { ProfileWithTeams } from '@/types'

type RequestStatus = Database['public']['Enums']['request_status']
type RequestPriority = Database['public']['Enums']['request_priority']
type TaskStatus = Database['public']['Enums']['task_status']
type TaskPriority = Database['public']['Enums']['task_priority']

// ── Shared filter type — _module switches which table is queried ──────────────

export type DrawerFilter = {
  title: string
  description?: string
  _module?: 'requests' | 'tasks'  // defaults to 'requests'
  // Request filters
  status?: string[]
  priority?: string
  teamId?: string
  assignedTo?: string
  slaBreached?: boolean
  frtBreached?: boolean
  resolvedInPeriod?: boolean
  createdInPeriod?: boolean
  closedInPeriod?: boolean
  period?: PeriodParam
  sort?: 'created_desc' | 'tat_desc' | 'priority'
  // Task-specific filters
  taskOverdue?: boolean
  taskCompletedInPeriod?: boolean
  taskType?: 'personal' | 'team'
  taskLinkedToRequest?: boolean
  taskStandalone?: boolean
}

// ── Request drawer ────────────────────────────────────────────────────────────

export type DrawerRequest = {
  id: string
  title: string
  status: string
  priority: string
  created_at: string
  resolved_at: string | null
  assigned_to: string | null
  team_id: string | null
  resolution_due_at: string | null
  responded_at: string | null
  assignee_name: string | null
  team_name: string | null
  service_name: string | null
}

export async function getFilteredRequests(filter: DrawerFilter): Promise<{
  data: DrawerRequest[]
  error?: string
}> {
  // D-03: this action queries via the RLS-bypassing admin client (needed to
  // join assignee/team/service display names in one round trip), so it must
  // do its own role/team/ownership scoping in application code — RLS is not
  // in the loop at all here. authorizeReportAccess() is the same scope
  // resolver already used by the report builder (lib/queries/reporting.ts)
  // for this exact entity; reusing it keeps "who can see which requests"
  // defined in exactly one place instead of a second, divergent copy.
  const access = await authorizeReportAccess('requests')
  if ('error' in access) return { data: [], error: access.error }
  const { profile, scope } = access

  // Route to task query if module = tasks
  if (filter._module === 'tasks') {
    const res = await getFilteredTasks(filter, profile)
    // Return as DrawerRequest shape so DrawerRequest component works for both
    return {
      data: res.data.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        created_at: t.created_at,
        resolved_at: t.completed_at,
        assigned_to: t.assignee_id,
        team_id: t.team_id,
        resolution_due_at: t.due_date,
        responded_at: null,
        assignee_name: t.assignee_name,
        team_name: t.team_name,
        service_name: null,
      })),
      error: res.error,
    }
  }

  // { kind: 'team' } with no teams means "on no team" — an empty .in()
  // filter would otherwise match every row instead of none (mirrors the
  // same guard in lib/queries/reporting.ts's fetchReportData()).
  if (scope.kind === 'team' && scope.teamIds.length === 0) return { data: [] }

  try {
    const admin = createAdminClient()
    const now   = new Date().toISOString()

    let q = admin
      .from('requests')
      .select(`
        id, title, status, priority, created_at, resolved_at,
        assigned_to, team_id, resolution_due_at, response_due_at, responded_at,
        assignee:profiles!requests_assigned_to_fkey(full_name),
        team:teams(name),
        service:services(name)
      `)
      .eq('org_id', profile.org_id!)

    // Caller-supplied filters narrow further, but can never widen past the
    // viewer's own resolved scope — a user/agent passing someone else's
    // teamId/assignedTo must not be able to see outside their own data.
    if (scope.kind === 'own')        q = q.eq('requester_id', scope.userId)
    else if (scope.kind === 'agent') q = q.or(`assigned_to.eq.${scope.userId},requester_id.eq.${scope.userId}`)
    else if (scope.kind === 'team')  q = q.in('team_id', scope.teamIds)

    if (filter.status?.length)   q = q.in('status', filter.status as RequestStatus[])
    if (filter.priority)         q = q.eq('priority', filter.priority as RequestPriority)
    if (filter.teamId)           q = q.eq('team_id', filter.teamId)
    if (filter.assignedTo)       q = q.eq('assigned_to', filter.assignedTo)

    if (filter.slaBreached) {
      // "Currently Breached" (D-01, lib/sla/breach.ts) — same formula as
      // Home Dashboard/Monitoring/the Admin Analytics KPI card.
      q = applyCurrentlyBreachedFilter(q.not('resolution_due_at', 'is', null), now)
    }
    if (filter.frtBreached) {
      q = q.is('responded_at', null)
           .not('status', 'in', '("resolved","closed","cancelled")')
    }
    if (filter.resolvedInPeriod && filter.period) {
      const { start, end } = resolvePeriodParam(filter.period)
      q = q.gte('resolved_at', start.toISOString()).lte('resolved_at', end.toISOString()).not('resolved_at', 'is', null)
    }
    if (filter.createdInPeriod && filter.period) {
      const { start, end } = resolvePeriodParam(filter.period)
      q = q.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
    }
    if (filter.closedInPeriod && filter.period) {
      const { start, end } = resolvePeriodParam(filter.period)
      q = q.gte('closed_at', start.toISOString()).lte('closed_at', end.toISOString()).not('closed_at', 'is', null)
    }

    q = q.order('created_at', { ascending: false }).limit(50)

    const { data, error } = await q
    if (error) return { data: [], error: error.message }

    type RequestQueryRow = {
      id: string; title: string; status: string; priority: string
      created_at: string; resolved_at: string | null
      assigned_to: string | null; team_id: string | null
      resolution_due_at: string | null; responded_at: string | null
      assignee: { full_name: string | null } | null
      team: { name: string } | null
      service: { name: string } | null
    }

    return {
      data: ((data ?? []) as RequestQueryRow[]).map((r) => ({
        id: r.id, title: r.title, status: r.status, priority: r.priority,
        created_at: r.created_at, resolved_at: r.resolved_at,
        assigned_to: r.assigned_to, team_id: r.team_id,
        resolution_due_at: r.resolution_due_at, responded_at: r.responded_at,
        assignee_name: r.assignee?.full_name ?? null,
        team_name: r.team?.name ?? null,
        service_name: r.service?.name ?? null,
      })),
    }
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Task drawer ───────────────────────────────────────────────────────────────

type DrawerTask = {
  id: string
  title: string
  status: string
  priority: string
  created_at: string
  completed_at: string | null
  assignee_id: string | null
  team_id: string | null
  due_date: string | null
  task_type: string
  assignee_name: string | null
  team_name: string | null
}

// D-03: there is no shared report-viewer scope for 'tasks' (reporting/access.ts
// deliberately treats every non-'requests' entity as admin/manager/
// platform_owner-only — too broad a block for this drawer, which agents use
// from their own team-tasks/my-tasks dashboard tiles). Instead this mirrors
// the actual tasks_select RLS policy (the ground-truth access rule already
// enforced at the database level for every other task read in the app):
//   created_by = self OR assignee_id = self
//   OR (task_type = 'team' AND team_id IN <the viewer's teams>)
//   OR role IN (manager, admin, platform_owner)  -- org-wide, no team limit
// 'user' has no clause at all in tasks_select — tasks are an agent-tier-and-
// above concept in this app (see isAgentOrAboveRole() in lib/actions/tasks.ts).
type TaskViewerScope =
  | { kind: 'all' }
  | { kind: 'agent'; userId: string; teamIds: string[] }
  | { kind: 'none' }

function resolveTaskAccess(profile: ProfileWithTeams): TaskViewerScope {
  switch (profile.role) {
    case 'admin':
    case 'platform_owner':
    case 'manager':
      return { kind: 'all' }
    case 'agent':
      return { kind: 'agent', userId: profile.id, teamIds: profile.team_members.map((tm) => tm.team_id) }
    default:
      return { kind: 'none' }
  }
}

async function getFilteredTasks(filter: DrawerFilter, profile: ProfileWithTeams): Promise<{
  data: DrawerTask[]
  error?: string
}> {
  const scope = resolveTaskAccess(profile)
  if (scope.kind === 'none') return { data: [], error: "You don't have access to this report." }

  try {
    const admin = createAdminClient()
    const now   = new Date().toISOString()

    let q = admin
      .from('tasks')
      .select(`
        id, title, status, priority, task_type,
        created_at, completed_at, due_date,
        assignee_id, team_id, request_id,
        assignee:profiles!tasks_assignee_id_fkey(full_name),
        team:teams(name)
      `)
      .eq('org_id', profile.org_id!)

    // Caller-supplied filters (teamId/assignedTo/...) narrow further below,
    // but can never widen past this — an agent passing another team's id
    // must not be able to see outside their own assigned/created/team tasks.
    if (scope.kind === 'agent') {
      const teamClause = scope.teamIds.length > 0 ? `,and(task_type.eq.team,team_id.in.(${scope.teamIds.join(',')}))` : ''
      q = q.or(`assignee_id.eq.${scope.userId},created_by.eq.${scope.userId}${teamClause}`)
    }

    if (filter.status?.length)   q = q.in('status', filter.status as TaskStatus[])
    if (filter.priority)         q = q.eq('priority', filter.priority as TaskPriority)
    if (filter.teamId)           q = q.eq('team_id', filter.teamId)
    if (filter.assignedTo)       q = q.eq('assignee_id', filter.assignedTo)
    if (filter.taskType)         q = q.eq('task_type', filter.taskType)
    if (filter.taskLinkedToRequest) q = q.not('request_id', 'is', null)
    if (filter.taskStandalone)      q = q.is('request_id', null)

    if (filter.taskOverdue) {
      q = q.not('due_date', 'is', null).lt('due_date', now)
           .not('status', 'in', '("done","cancelled")')
    }
    if (filter.taskCompletedInPeriod && filter.period) {
      const { start, end } = resolvePeriodParam(filter.period)
      q = q.gte('completed_at', start.toISOString()).lte('completed_at', end.toISOString()).not('completed_at', 'is', null)
    }
    if (filter.createdInPeriod && filter.period) {
      const { start, end } = resolvePeriodParam(filter.period)
      q = q.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
    }

    q = q.order('created_at', { ascending: false }).limit(50)

    const { data, error } = await q
    if (error) return { data: [], error: error.message }

    type TaskQueryRow = {
      id: string; title: string; status: string; priority: string; task_type: string
      created_at: string; completed_at: string | null; due_date: string | null
      assignee_id: string | null; team_id: string | null
      assignee: { full_name: string | null } | null
      team: { name: string } | null
    }

    return {
      data: ((data ?? []) as TaskQueryRow[]).map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
        task_type: t.task_type, created_at: t.created_at,
        completed_at: t.completed_at, due_date: t.due_date,
        assignee_id: t.assignee_id, team_id: t.team_id,
        assignee_name: t.assignee?.full_name ?? null,
        team_name: t.team?.name ?? null,
      })),
    }
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e) }
  }
}
