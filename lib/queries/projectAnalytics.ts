import { createAdminClient } from '@/lib/supabase/admin'
import { TASK_STATUS_GROUP, REQUEST_STATUS_GROUP } from '@/lib/constants/status-groups'
import { computeProjectProgressPct } from '@/lib/projects/progress'
import type { BacklogAging } from './analytics'
import type { TaskStatus, RequestStatus, ProjectStatus } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// ── Types ──────────────────────────────────────────────────────────────────────

export type OwnerWorkloadRow = { assigneeId: string; assigneeName: string; count: number }

export type MilestoneTimelineRow = {
  id: string; name: string; projectId: string; projectName: string
  status: string; startDate: string | null; endDate: string
}

export type ProgressTrendPoint = { date: string; avg: number; updates: number }

// A single dated bar for the load-detection Gantt — either a project itself
// or one of its milestones. Grouped/plotted client-side (By Project / By Owner).
export type LoadItem = {
  id: string
  kind: 'project' | 'milestone'
  name: string
  status: string
  startDate: string | null
  endDate: string
  projectId: string
  projectName: string
  ownerId: string
  ownerName: string
}

export type OwnerRollupRow = {
  ownerId: string
  ownerName: string
  totalProjects: number
  notStarted: number
  inProgress: number
  blocked: number
  done: number
  cancelled: number
  overdue: number
  dueSoon: number // due within 7 days, not done/cancelled
  avgProgressPct: number
}

export type DeliveryBuckets = { overdue: number; due7: number; due30: number; dueLater: number; noDate: number }

export type ManagerRollup = {
  managerId: string
  managerName: string
  reports: OwnerRollupRow[]
  stats: OwnerRollupRow // aggregated across the manager's own projects + every direct report's
}

export type ProjectAnalyticsData = {
  nowIso: string
  projectsActive: number
  projectsByStatus: Array<{ status: string; count: number }>
  milestonesOverdue: number
  milestonesDueSoon: number
  projectOwnerWorkload: OwnerWorkloadRow[]
  milestonesTimeline: MilestoneTimelineRow[]
  loadItems: LoadItem[]
  milestoneOverdueAging: BacklogAging
  projectProgressTrend: ProgressTrendPoint[]
  managerRollups: ManagerRollup[]
  unmanagedOwners: OwnerRollupRow[] // project owners with no manager_id set
  allOwnerRows: OwnerRollupRow[] // every project owner, flat — not nested under a manager
  deliveryBuckets: DeliveryBuckets // all open projects + active milestones, bucketed by due window
}

// ── Main query ─────────────────────────────────────────────────────────────────

export async function getProjectAnalytics(orgId: string): Promise<ProjectAnalyticsData> {
  const admin = createAdminClient() as unknown as AnyClient
  const now = new Date()

  // Admin client bypasses RLS — every query here must filter by org_id itself.
  // milestones/project_updates/tasks/requests have no direct org_id column,
  // so they're scoped via their parent project's org_id after the fact
  // (projectsArr below is already org-filtered, and everything else is
  // filtered against project IDs drawn from it).
  const [
    { data: projectsRaw },
    { data: milestonesRaw },
    { data: projectUpdatesRaw },
    { data: tasksRaw },
    { data: requestsRaw },
    { data: profilesRaw },
  ] = await Promise.all([
    admin.from('projects').select('id, name, owner_id, status, start_date, target_date').eq('org_id', orgId).is('archived_at', null),
    admin
      .from('milestones')
      .select('id, name, status, start_date, end_date, project_id, project:projects(name)')
      .eq('org_id', orgId)
      .not('status', 'in', '("done","cancelled")'),
    admin
      .from('project_updates')
      .select('project_id, update_date, percent_snapshot')
      .eq('org_id', orgId)
      .order('update_date', { ascending: true }),
    admin.from('tasks').select('status, assignee_id, project_id').eq('org_id', orgId).not('project_id', 'is', null),
    admin.from('requests').select('status, project_id').eq('org_id', orgId).not('project_id', 'is', null),
    admin.from('profiles').select('id, full_name, manager_id').eq('org_id', orgId),
  ])

  const projectsArr = (projectsRaw ?? []) as Array<{
    id: string; name: string; owner_id: string; status: ProjectStatus; start_date: string | null; target_date: string | null
  }>
  const milestonesArr = (milestonesRaw ?? []) as Array<{
    id: string; name: string; status: string; start_date: string | null; end_date: string | null
    project_id: string; project: { name: string } | null
  }>
  const tasksArr = (tasksRaw ?? []) as Array<{ status: TaskStatus; assignee_id: string | null; project_id: string }>
  const requestsArr = (requestsRaw ?? []) as Array<{ status: RequestStatus; project_id: string }>
  const profilesArr = (profilesRaw ?? []) as Array<{ id: string; full_name: string; manager_id: string | null }>
  const profileById = new Map(profilesArr.map((p) => [p.id, p]))
  const projectById = new Map(projectsArr.map((p) => [p.id, p]))

  // ── Project KPIs ──────────────────────────────────────────────────────────

  const projectsActive = projectsArr.filter((p) => p.status !== 'done' && p.status !== 'cancelled').length
  const projectStatusCounts: Record<string, number> = {}
  for (const p of projectsArr) projectStatusCounts[p.status] = (projectStatusCounts[p.status] ?? 0) + 1
  const projectsByStatus = Object.entries(projectStatusCounts).map(([status, count]) => ({ status, count }))

  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  // Milestones without an end_date (not yet scheduled) can't be overdue/due-soon —
  // exclude rather than let a null slip into `new Date(null)` (silently epoch-1970,
  // which would wrongly count as "overdue").
  const milestonesOverdue = milestonesArr.filter((m) => m.end_date && new Date(m.end_date) < now).length
  const milestonesDueSoon = milestonesArr.filter(
    (m) => m.end_date && new Date(m.end_date) >= now && new Date(m.end_date) <= sevenDaysOut
  ).length

  // ── Owner workload — open (non-done/cancelled) project-linked tasks, by assignee ──

  const projectTasksOpen = tasksArr.filter((t) => !['done', 'cancelled'].includes(t.status))
  const workloadCounts: Record<string, number> = {}
  for (const t of projectTasksOpen) {
    if (!t.assignee_id) continue
    workloadCounts[t.assignee_id] = (workloadCounts[t.assignee_id] ?? 0) + 1
  }
  const projectOwnerWorkload: OwnerWorkloadRow[] = Object.entries(workloadCounts)
    .map(([assigneeId, count]) => ({
      assigneeId,
      assigneeName: profileById.get(assigneeId)?.full_name ?? 'Unknown',
      count,
    }))
    .sort((a, b) => b.count - a.count)

  // ── Milestones timeline (portfolio Gantt) ────────────────────────────────

  // Milestones with no end_date yet (not scheduled) can't be plotted on a
  // dated Gantt row — exclude them here rather than fake a date.
  const milestonesTimeline: MilestoneTimelineRow[] = milestonesArr
    .filter((m): m is typeof m & { end_date: string } => !!m.end_date)
    .map((m) => ({
      id: m.id,
      name: m.name,
      projectId: m.project_id,
      projectName: m.project?.name ?? 'Unknown project',
      status: m.status,
      startDate: m.start_date,
      endDate: m.end_date,
    }))

  // ── Load-detection Gantt items ────────────────────────────────────────────
  // One bar per open project (needs a target_date) plus one per active
  // milestone — grouped/plotted client-side (By Project / By Owner) so the
  // toggle needs no extra round-trip.

  const projectLoadItems: LoadItem[] = projectsArr
    .filter((p) => p.status !== 'done' && p.status !== 'cancelled' && p.target_date)
    .map((p) => ({
      id: p.id,
      kind: 'project',
      name: p.name,
      status: p.status,
      startDate: p.start_date,
      endDate: p.target_date!,
      projectId: p.id,
      projectName: p.name,
      ownerId: p.owner_id,
      ownerName: profileById.get(p.owner_id)?.full_name ?? 'Unknown',
    }))

  const milestoneLoadItems: LoadItem[] = milestonesArr
    .filter((m): m is typeof m & { end_date: string } => !!m.end_date)
    .map((m) => {
      const project = projectById.get(m.project_id)
      const ownerId = project?.owner_id ?? ''
      return {
        id: m.id,
        kind: 'milestone',
        name: m.name,
        status: m.status,
        startDate: m.start_date,
        endDate: m.end_date,
        projectId: m.project_id,
        projectName: m.project?.name ?? 'Unknown project',
        ownerId,
        ownerName: profileById.get(ownerId)?.full_name ?? 'Unknown',
      }
    })

  const loadItems: LoadItem[] = [...projectLoadItems, ...milestoneLoadItems]

  // ── Overdue-milestone aging ───────────────────────────────────────────────

  const overdueMilestones = milestonesArr
    .filter((m): m is typeof m & { end_date: string } => !!m.end_date)
    .filter((m) => new Date(m.end_date) < now)
  const daysOverdue = (m: { end_date: string }) => (now.getTime() - new Date(m.end_date).getTime()) / (1000 * 3600 * 24)
  const milestoneOverdueAging: BacklogAging = {
    d1:      overdueMilestones.filter((m) => daysOverdue(m) < 1).length,
    d7:      overdueMilestones.filter((m) => daysOverdue(m) >= 1 && daysOverdue(m) < 7).length,
    d30:     overdueMilestones.filter((m) => daysOverdue(m) >= 7 && daysOverdue(m) < 30).length,
    d30plus: overdueMilestones.filter((m) => daysOverdue(m) >= 30).length,
  }

  // ── Progress trend — walk the last 30 days, carrying forward each project's
  // latest known % (from project_updates). Anchored in UTC-midnight arithmetic:
  // update_date is a plain DATE column (no timezone), and bare "YYYY-MM-DD"
  // strings parse as UTC midnight per spec — mixing in a local-timezone Date
  // here would silently roll the "today" bucket back a day whenever the
  // server's timezone is ahead of UTC.

  const projectUpdates = (projectUpdatesRaw ?? []) as Array<{
    project_id: string; update_date: string; percent_snapshot: number
  }>
  const projectProgressTrend: ProgressTrendPoint[] = []
  if (projectUpdates.length > 0) {
    const byDate = new Map<string, typeof projectUpdates>()
    for (const u of projectUpdates) {
      const key = u.update_date.slice(0, 10)
      byDate.set(key, [...(byDate.get(key) ?? []), u])
    }
    const sortedDates = [...byDate.keys()].sort()
    const earliestMs = Date.parse(`${sortedDates[0]}T00:00:00Z`)
    const todayMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const windowStartMs = Math.max(earliestMs, todayMidnightMs - 29 * 86_400_000)

    const latest = new Map<string, number>()
    for (const d of sortedDates) {
      if (Date.parse(`${d}T00:00:00Z`) >= windowStartMs) break
      for (const u of byDate.get(d)!) latest.set(u.project_id, u.percent_snapshot)
    }

    for (let t = windowStartMs; t <= todayMidnightMs; t += 24 * 60 * 60 * 1000) {
      const key = new Date(t).toISOString().slice(0, 10)
      const todays = byDate.get(key) ?? []
      for (const u of todays) latest.set(u.project_id, u.percent_snapshot)
      const values = [...latest.values()]
      projectProgressTrend.push({
        date: key,
        avg: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
        updates: todays.length,
      })
    }
  }

  // ── Manager rollup ────────────────────────────────────────────────────────
  // Per-project-owner stats, then grouped by their manager (profiles.manager_id
  // — a real FK, not the string-matching a lot of trackers resort to).

  const todayStr = now.toISOString().slice(0, 10)

  function bucketProgress(projectId: string, status: ProjectStatus): number {
    const tRows = tasksArr.filter((t) => t.project_id === projectId)
    const rRows = requestsArr.filter((r) => r.project_id === projectId)
    const total = tRows.length + rRows.length
    const done =
      tRows.filter((t) => TASK_STATUS_GROUP[t.status] === 'done').length +
      rRows.filter((r) => REQUEST_STATUS_GROUP[r.status] === 'done').length
    return computeProjectProgressPct(status, { done, total })
  }

  const sevenDaysOutStr = sevenDaysOut.toISOString().slice(0, 10)

  function emptyOwnerRow(ownerId: string, ownerName: string): OwnerRollupRow {
    return {
      ownerId, ownerName, totalProjects: 0,
      notStarted: 0, inProgress: 0, blocked: 0, done: 0, cancelled: 0,
      overdue: 0, dueSoon: 0, avgProgressPct: 0,
    }
  }

  function addProjectToRow(row: OwnerRollupRow, p: typeof projectsArr[number], progressSum: { value: number }) {
    row.totalProjects++
    row[
      p.status === 'not_started' ? 'notStarted'
      : p.status === 'in_progress' ? 'inProgress'
      : p.status === 'blocked' ? 'blocked'
      : p.status === 'done' ? 'done'
      : 'cancelled'
    ]++
    const isOpen = p.status !== 'done' && p.status !== 'cancelled'
    if (p.target_date && isOpen) {
      if (p.target_date < todayStr) row.overdue++
      else if (p.target_date <= sevenDaysOutStr) row.dueSoon++
    }
    progressSum.value += bucketProgress(p.id, p.status)
  }

  const ownerRows = new Map<string, { row: OwnerRollupRow; progressSum: { value: number } }>()
  for (const p of projectsArr) {
    if (!ownerRows.has(p.owner_id)) {
      const ownerName = profileById.get(p.owner_id)?.full_name ?? 'Unknown'
      ownerRows.set(p.owner_id, { row: emptyOwnerRow(p.owner_id, ownerName), progressSum: { value: 0 } })
    }
    const entry = ownerRows.get(p.owner_id)!
    addProjectToRow(entry.row, p, entry.progressSum)
  }
  for (const { row, progressSum } of ownerRows.values()) {
    row.avgProgressPct = row.totalProjects > 0 ? Math.round(progressSum.value / row.totalProjects) : 0
  }

  const ownerRowList = [...ownerRows.values()].map((e) => e.row)

  // Group owners by manager_id
  const byManager = new Map<string, OwnerRollupRow[]>()
  const unmanagedOwners: OwnerRollupRow[] = []
  for (const row of ownerRowList) {
    const managerId = profileById.get(row.ownerId)?.manager_id ?? null
    if (!managerId) { unmanagedOwners.push(row); continue }
    byManager.set(managerId, [...(byManager.get(managerId) ?? []), row])
  }

  function sumRows(rows: OwnerRollupRow[]): OwnerRollupRow {
    const total = rows.reduce((s, r) => s + r.totalProjects, 0)
    const weightedProgress = rows.reduce((s, r) => s + r.avgProgressPct * r.totalProjects, 0)
    return {
      ownerId: '', ownerName: '',
      totalProjects: total,
      notStarted: rows.reduce((s, r) => s + r.notStarted, 0),
      inProgress: rows.reduce((s, r) => s + r.inProgress, 0),
      blocked: rows.reduce((s, r) => s + r.blocked, 0),
      done: rows.reduce((s, r) => s + r.done, 0),
      cancelled: rows.reduce((s, r) => s + r.cancelled, 0),
      overdue: rows.reduce((s, r) => s + r.overdue, 0),
      dueSoon: rows.reduce((s, r) => s + r.dueSoon, 0),
      avgProgressPct: total > 0 ? Math.round(weightedProgress / total) : 0,
    }
  }

  const managerRollups: ManagerRollup[] = [...byManager.entries()]
    .map(([managerId, reports]) => {
      const manager = profileById.get(managerId)
      // Include the manager's own projects (if they own any) in the rollup scope.
      const ownRow = ownerRows.get(managerId)?.row
      const scope = ownRow ? [ownRow, ...reports] : reports
      return {
        managerId,
        managerName: manager?.full_name ?? 'Unknown',
        reports: [...reports].sort((a, b) => b.totalProjects - a.totalProjects),
        stats: { ...sumRows(scope), ownerId: managerId, ownerName: manager?.full_name ?? 'Unknown' },
      }
    })
    .sort((a, b) => b.stats.totalProjects - a.stats.totalProjects)

  // ── Delivery timeline — every open project + active milestone, bucketed by
  // due window. Broader than milestoneOverdueAging (overdue-only): this also
  // covers what's due soon, later, or has no date set at all.

  const deliveryBuckets: DeliveryBuckets = { overdue: 0, due7: 0, due30: 0, dueLater: 0, noDate: 0 }
  const openProjects = projectsArr.filter((p) => p.status !== 'done' && p.status !== 'cancelled')
  for (const p of openProjects) {
    if (!p.target_date) { deliveryBuckets.noDate++; continue }
    if (p.target_date < todayStr) deliveryBuckets.overdue++
    else if (p.target_date <= sevenDaysOutStr) deliveryBuckets.due7++
    else if (Date.parse(p.target_date) <= now.getTime() + 30 * 86_400_000) deliveryBuckets.due30++
    else deliveryBuckets.dueLater++
  }
  for (const m of milestonesArr) {
    if (!m.end_date) { deliveryBuckets.noDate++; continue }
    const endStr = m.end_date.slice(0, 10)
    if (endStr < todayStr) deliveryBuckets.overdue++
    else if (endStr <= sevenDaysOutStr) deliveryBuckets.due7++
    else if (Date.parse(endStr) <= now.getTime() + 30 * 86_400_000) deliveryBuckets.due30++
    else deliveryBuckets.dueLater++
  }

  return {
    nowIso: now.toISOString(),
    projectsActive,
    projectsByStatus,
    milestonesOverdue,
    milestonesDueSoon,
    projectOwnerWorkload,
    milestonesTimeline,
    loadItems,
    milestoneOverdueAging,
    projectProgressTrend,
    managerRollups,
    unmanagedOwners: unmanagedOwners.sort((a, b) => b.totalProjects - a.totalProjects),
    allOwnerRows: ownerRowList.sort((a, b) => b.totalProjects - a.totalProjects),
    deliveryBuckets,
  }
}
