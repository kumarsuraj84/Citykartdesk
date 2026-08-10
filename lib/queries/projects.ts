import { createClient } from '@/lib/supabase/server'
import { TASK_STATUS_GROUP, REQUEST_STATUS_GROUP } from '@/lib/constants/status-groups'
import type { Tables } from '@/types/database'
import type {
  ProjectWithDetails,
  ProjectActivityWithActor,
  ProjectProgress,
  ProjectStatus,
  ProjectPriority,
  TaskStatus,
  RequestStatus,
  MilestoneWithDetails,
  ProjectMemberWithProfile,
  ProjectUpdateWithAuthor,
} from '@/types'

export type { ProjectWithDetails, ProjectActivityWithActor, ProjectProgress }

const PROJECT_SELECT = `*, owner:profiles!projects_owner_id_fkey (id, full_name), functional_owner:profiles!projects_functional_owner_id_fkey (id, full_name), team:teams (id, name)`
const MILESTONE_SELECT = `*, owner:profiles!milestones_owner_id_fkey (id, full_name), functional_owner:profiles!milestones_functional_owner_id_fkey (id, full_name)`

export interface PaginatedProjects {
  data: ProjectWithDetails[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function getProjects(opts: {
  status?: ProjectStatus
  priority?: ProjectPriority
  teamId?: string
  ownerId?: string
  includeArchived?: boolean
  /** Matches against name, description, or owner/functional-owner name — scans the full table, not just the current page. */
  search?: string
  page?: number
  pageSize?: number
}): Promise<PaginatedProjects> {
  const supabase = await createClient()
  const pg = opts.page ?? 1
  const size = opts.pageSize ?? 50
  const from = (pg - 1) * size
  const to = from + size - 1

  let query = supabase
    .from('projects')
    .select(PROJECT_SELECT, { count: 'exact' })

  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.status) query = query.eq('status', opts.status)
  if (opts.priority) query = query.eq('priority', opts.priority)
  if (opts.teamId) query = query.eq('team_id', opts.teamId)
  if (opts.ownerId) query = query.eq('owner_id', opts.ownerId)

  const search = opts.search?.trim()
  if (search) {
    const { data: matchingProfiles } = await supabase
      .from('profiles')
      .select('id')
      .ilike('full_name', `%${search}%`)
    const ownerIds = (matchingProfiles ?? []).map((p) => p.id)
    const clauses = [`name.ilike.%${search}%`, `description.ilike.%${search}%`]
    if (ownerIds.length > 0) {
      clauses.push(`owner_id.in.(${ownerIds.join(',')})`, `functional_owner_id.in.(${ownerIds.join(',')})`)
    }
    query = query.or(clauses.join(','))
  }

  query = query.order('created_at', { ascending: false }).range(from, to)

  const { data, count } = await query
  const total = count ?? 0

  return {
    data: (data ?? []) as ProjectWithDetails[],
    total,
    page: pg,
    pageSize: size,
    totalPages: Math.ceil(total / size),
  }
}

export async function getProjectById(id: string): Promise<ProjectWithDetails | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('id', id)
    .single()
  return (data as ProjectWithDetails) ?? null
}

export async function getProjectActivity(projectId: string): Promise<ProjectActivityWithActor[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('project_activity')
    .select(`*, actor:profiles!project_activity_actor_id_fkey (id, full_name)`)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data ?? []) as ProjectActivityWithActor[]
}

// ── Canonical status-group bucketing ─────────────────────────────────────────
// Mapping lives in lib/constants/status-groups.ts — shared with milestone
// burndown so both read from one source of truth.

function emptyProgress(): ProjectProgress {
  return { not_started: 0, in_progress: 0, blocked: 0, done: 0, cancelled: 0, total: 0 }
}

function bucketTasks(progress: ProjectProgress, rows: { status: TaskStatus }[]) {
  for (const row of rows) {
    const group = TASK_STATUS_GROUP[row.status] ?? 'not_started'
    progress[group]++
    progress.total++
  }
}

function bucketRequests(progress: ProjectProgress, rows: { status: RequestStatus }[]) {
  for (const row of rows) {
    const group = REQUEST_STATUS_GROUP[row.status] ?? 'not_started'
    progress[group]++
    progress.total++
  }
}

export async function getProjectProgress(projectId: string): Promise<ProjectProgress> {
  const supabase = await createClient()

  const [{ data: taskRows }, { data: requestRows }] = await Promise.all([
    supabase.from('tasks').select('status').eq('project_id', projectId),
    supabase.from('requests').select('status').eq('project_id', projectId),
  ])

  const progress = emptyProgress()
  bucketTasks(progress, taskRows ?? [])
  bucketRequests(progress, requestRows ?? [])
  return progress
}

/** Same result as calling getProjectProgress() once per id, but in 2 queries
 * total instead of 2×N — use this for any list/table view of multiple projects
 * (getProjectProgress itself stays as the single-project detail-page version). */
export async function getProjectsProgress(projectIds: string[]): Promise<Record<string, ProjectProgress>> {
  const result: Record<string, ProjectProgress> = {}
  for (const id of projectIds) result[id] = emptyProgress()
  if (projectIds.length === 0) return result

  const supabase = await createClient()
  const [{ data: taskRows }, { data: requestRows }] = await Promise.all([
    supabase.from('tasks').select('project_id, status').in('project_id', projectIds),
    supabase.from('requests').select('project_id, status').in('project_id', projectIds),
  ])

  for (const row of taskRows ?? []) {
    if (!row.project_id) continue
    bucketTasks(result[row.project_id], [{ status: row.status }])
  }
  for (const row of requestRows ?? []) {
    if (!row.project_id) continue
    bucketRequests(result[row.project_id], [{ status: row.status }])
  }
  return result
}

// ── Milestones ────────────────────────────────────────────────────────────────

export async function getMilestonesForProject(projectId: string): Promise<MilestoneWithDetails[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('milestones')
    .select(MILESTONE_SELECT)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('start_date', { ascending: true })
  return (data as MilestoneWithDetails[]) ?? []
}

export async function getMilestoneProgress(milestoneId: string): Promise<ProjectProgress> {
  const supabase = await createClient()
  const { data: taskRows } = await supabase.from('tasks').select('status').eq('milestone_id', milestoneId)

  const progress = emptyProgress()
  bucketTasks(progress, taskRows ?? [])
  return progress
}

// ── Project members ──────────────────────────────────────────────────────────

export async function getProjectMembers(projectId: string): Promise<ProjectMemberWithProfile[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('project_members')
    .select(`*, user:profiles!project_members_user_id_fkey (id, full_name)`)
    .eq('project_id', projectId)
    .order('joined_at', { ascending: true })
  return (data ?? []) as ProjectMemberWithProfile[]
}

export async function getAllTeamsMini(): Promise<Pick<Tables<'teams'>, 'id' | 'name'>[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('teams').select('id, name').order('name', { ascending: true })
  return data ?? []
}

export type HomeProjectsSummary = {
  activeCount: number
  blockedCount: number
  milestonesOverdue: number
  milestonesDueSoon: number
  /** True count of at-risk projects — independent of how many are in the `atRisk` preview list below. */
  atRiskCount: number
  /** Preview list, capped to 5 for display — use `atRiskCount` for the real total. */
  atRisk: { id: string; name: string; status: ProjectStatus; target_date: string | null }[]
}

/** Lightweight, home-page-scoped summary — a separate, non-blocking query
 * (not folded into get_home_dashboard) so the tuned RPC's performance
 * characteristics stay untouched. See docs/ARCHITECTURE.md §4. */
export async function getHomeProjectsSummary(): Promise<HomeProjectsSummary> {
  const supabase = await createClient()
  const now = new Date().toISOString().slice(0, 10)
  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [{ data: projects }, { data: milestones }] = await Promise.all([
    supabase.from('projects').select('id, name, status, target_date').is('archived_at', null),
    supabase.from('milestones').select('id, end_date').not('status', 'in', '("done","cancelled")'),
  ])

  const projectsArr = projects ?? []
  const milestonesArr = milestones ?? []

  const activeCount = projectsArr.filter((p) => p.status !== 'done' && p.status !== 'cancelled').length
  const blockedCount = projectsArr.filter((p) => p.status === 'blocked').length
  const milestonesOverdue = milestonesArr.filter((m) => !!m.end_date && m.end_date < now).length
  const milestonesDueSoon = milestonesArr.filter((m) => !!m.end_date && m.end_date >= now && m.end_date <= sevenDaysOut).length

  const atRiskAll = projectsArr.filter((p) =>
    p.status === 'blocked' ||
    (p.target_date && p.target_date < now && p.status !== 'done' && p.status !== 'cancelled')
  )
  const atRisk = atRiskAll
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, status: p.status, target_date: p.target_date }))

  return { activeCount, blockedCount, milestonesOverdue, milestonesDueSoon, atRiskCount: atRiskAll.length, atRisk }
}

export async function getAllProjectsMini(): Promise<Pick<Tables<'projects'>, 'id' | 'name'>[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('projects')
    .select('id, name')
    .is('archived_at', null)
    .order('name', { ascending: true })
  return data ?? []
}

// ── Project updates (narrative status log) ──────────────────────────────────

export async function getProjectUpdates(projectId: string): Promise<ProjectUpdateWithAuthor[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('project_updates')
    .select(`*, author:profiles!project_updates_author_id_fkey (id, full_name)`)
    .eq('project_id', projectId)
    .order('update_date', { ascending: false })
    .order('created_at', { ascending: false })
  return (data ?? []) as ProjectUpdateWithAuthor[]
}

/** Most recent update per project — one query, reduced client-side to first-per-project.
 * Powers the "days since last update" staleness signal on the dense table view. */
export async function getLatestUpdateByProject(): Promise<
  Record<string, { updateDate: string; updateText: string }>
> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('project_updates')
    .select('project_id, update_date, update_text, created_at')
    .order('update_date', { ascending: false })
    .order('created_at', { ascending: false })

  const byProject: Record<string, { updateDate: string; updateText: string }> = {}
  for (const row of data ?? []) {
    if (byProject[row.project_id]) continue
    byProject[row.project_id] = { updateDate: row.update_date, updateText: row.update_text }
  }
  return byProject
}

export type ProjectStats = {
  total: number
  inProgress: number
  notStarted: number
  blocked: number
  done: number
  /** Active projects (not done/cancelled) with no update in the last 5 days, or none at all. */
  stale: number
}

/** Org-wide status counts + staleness signal for the Projects dashboard header —
 * scans every non-archived project, not just the current page.
 * `latestUpdateByProject` is optional — pass it in when the caller already fetched
 * it (e.g. the /projects page needs it for the table too) to avoid running the
 * same project_updates scan twice; omit it to have this function fetch it itself. */
export async function getProjectStats(
  latestUpdateByProject?: Record<string, { updateDate: string; updateText: string }>
): Promise<ProjectStats> {
  const supabase = await createClient()
  const [{ data: projects }, latestUpdates] = await Promise.all([
    supabase.from('projects').select('id, status').is('archived_at', null),
    latestUpdateByProject ? Promise.resolve(latestUpdateByProject) : getLatestUpdateByProject(),
  ])

  const rows = projects ?? []
  const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)

  let inProgress = 0, notStarted = 0, blocked = 0, done = 0, stale = 0
  for (const p of rows) {
    if (p.status === 'in_progress') inProgress++
    else if (p.status === 'not_started') notStarted++
    else if (p.status === 'blocked') blocked++
    else if (p.status === 'done') done++

    if (p.status === 'done' || p.status === 'cancelled') continue
    const latest = latestUpdates[p.id]?.updateDate
    if (!latest || latest < fiveDaysAgo) stale++
  }

  // Matches the 4 displayed cards (In Progress/Not Started/Blocked/Done) — cancelled
  // projects are deliberately excluded so "Total" always reconciles with what's shown.
  return { total: inProgress + notStarted + blocked + done, inProgress, notStarted, blocked, done, stale }
}
