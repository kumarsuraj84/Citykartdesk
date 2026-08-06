import { createAdminClient } from '@/lib/supabase/admin'
import { periodStart, type Period } from '@/lib/queries/analytics'

function avg(arr: number[]): number | null {
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

export type TaskTrendPoint = { date: string; created: number; completed: number }

export type TaskByStatus  = { status: string; count: number }
export type TaskByPriority = { priority: string; count: number; done: number; overdue: number; avgHours: number | null }
export type TaskByType    = { type: string; count: number }
export type TaskTeamRow   = { teamId: string; teamName: string; total: number; done: number; overdue: number; openNow: number; avgHours: number | null }
export type TaskAgentRow  = { agentId: string; agentName: string; open: number; done: number; overdue: number; avgHours: number | null }
export type TaskAging     = { d1: number; d7: number; d30: number; d30plus: number }

export type TaskAnalyticsData = {
  period: Period
  // Volume
  totalOpen: number
  totalOverdue: number
  totalCreatedInPeriod: number
  totalCompletedInPeriod: number
  completionRate: number | null         // done / (done + open) %
  netFlux: number                       // completed - created
  // Time
  avgCompletionHours: number | null
  medianCompletionHours: number | null
  // Distributions
  byStatus: TaskByStatus[]
  byPriority: TaskByPriority[]
  byType: TaskByType[]
  // Team & agent
  byTeam: TaskTeamRow[]
  agentLeaderboard: TaskAgentRow[]
  // Linked vs standalone
  linkedToRequests: number
  standalone: number
  // Trend
  trend: TaskTrendPoint[]
  // Aging (open only)
  aging: TaskAging
}

export async function getTaskAnalytics(period: Period): Promise<TaskAnalyticsData> {
  const admin  = createAdminClient()
  const start  = periodStart(period).toISOString()
  const now    = new Date()
  const nowIso = now.toISOString()
  const days   = period === '7d' ? 7 : period === '30d' ? 30 : 90

  const [
    { data: allTasks },
    { data: teamsData },
    { data: profilesData },
  ] = await Promise.all([
    admin.from('tasks').select('id,title,status,priority,task_type,assignee_id,team_id,request_id,created_at,completed_at,due_date'),
    admin.from('teams').select('id,name'),
    admin.from('profiles').select('id,full_name'),
  ])

  const tasks      = allTasks ?? []
  const teamMap    = Object.fromEntries((teamsData ?? []).map((t: any) => [t.id, t.name]))
  const profileMap = Object.fromEntries((profilesData ?? []).map((p: any) => [p.id, p.full_name]))

  const startDate  = new Date(start)
  const inPeriod   = (d: string) => new Date(d) >= startDate
  const isOpen     = (t: any) => !['done','cancelled'].includes(t.status)
  const isDone     = (t: any) => t.status === 'done'
  const isOverdue  = (t: any) => t.due_date && new Date(t.due_date) < now && isOpen(t)

  const periodTasks     = tasks.filter((t: any) => inPeriod(t.created_at))
  const completedPeriod = tasks.filter((t: any) => t.completed_at && inPeriod(t.completed_at))
  const openTasks       = tasks.filter(isOpen)
  const overdueTasks    = tasks.filter(isOverdue)

  // Avg completion hours
  const completionTimes = completedPeriod
    .filter((t: any) => t.completed_at)
    .map((t: any) => (new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime()) / 3_600_000)
  const avgCompletionHours    = avg(completionTimes)
  const medianCompletionHours = median(completionTimes)

  // By status (all tasks)
  const statusCount: Record<string, number> = {}
  for (const t of tasks) { statusCount[t.status] = (statusCount[t.status] ?? 0) + 1 }
  const byStatus = Object.entries(statusCount).map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)

  // By priority (period tasks)
  const priorityMap: Record<string, { count: number; done: number; overdue: number; times: number[] }> = {}
  for (const t of tasks) {
    const p = t.priority ?? 'medium'
    if (!priorityMap[p]) priorityMap[p] = { count: 0, done: 0, overdue: 0, times: [] }
    priorityMap[p].count++
    if (isDone(t)) priorityMap[p].done++
    if (isOverdue(t)) priorityMap[p].overdue++
    if (t.completed_at) {
      priorityMap[p].times.push((new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000)
    }
  }
  const ORDER = ['urgent','high','medium','low']
  const byPriority: TaskByPriority[] = ORDER
    .filter((p) => priorityMap[p])
    .map((p) => ({ priority: p, ...priorityMap[p], avgHours: avg(priorityMap[p].times) }))
    .map(({ times: _, ...rest }) => rest as TaskByPriority)

  // By type
  const typeCount: Record<string, number> = {}
  for (const t of tasks) { const k = t.task_type ?? 'personal'; typeCount[k] = (typeCount[k] ?? 0) + 1 }
  const byType = Object.entries(typeCount).map(([type, count]) => ({ type, count }))

  // By team
  const teamAgg: Record<string, { total: number; done: number; overdue: number; openNow: number; times: number[] }> = {}
  for (const t of tasks) {
    const tid = t.team_id ?? '__none__'
    if (!teamAgg[tid]) teamAgg[tid] = { total: 0, done: 0, overdue: 0, openNow: 0, times: [] }
    teamAgg[tid].total++
    if (isDone(t)) teamAgg[tid].done++
    if (isOverdue(t)) teamAgg[tid].overdue++
    if (isOpen(t)) teamAgg[tid].openNow++
    if (t.completed_at) teamAgg[tid].times.push((new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000)
  }
  const byTeam: TaskTeamRow[] = Object.entries(teamAgg)
    .filter(([tid]) => tid !== '__none__' && teamMap[tid])
    .map(([tid, agg]) => ({
      teamId: tid, teamName: teamMap[tid],
      total: agg.total, done: agg.done, overdue: agg.overdue, openNow: agg.openNow,
      avgHours: avg(agg.times),
    }))
    .sort((a, b) => b.total - a.total)

  // Agent leaderboard
  const agentAgg: Record<string, { open: number; done: number; overdue: number; times: number[] }> = {}
  for (const t of tasks) {
    const aid = t.assignee_id
    if (!aid) continue
    if (!agentAgg[aid]) agentAgg[aid] = { open: 0, done: 0, overdue: 0, times: [] }
    if (isOpen(t)) agentAgg[aid].open++
    if (isDone(t)) agentAgg[aid].done++
    if (isOverdue(t)) agentAgg[aid].overdue++
    if (t.completed_at) agentAgg[aid].times.push((new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000)
  }
  const agentLeaderboard: TaskAgentRow[] = Object.entries(agentAgg)
    .map(([aid, agg]) => ({
      agentId: aid, agentName: profileMap[aid] ?? 'Unknown',
      open: agg.open, done: agg.done, overdue: agg.overdue, avgHours: avg(agg.times),
    }))
    .sort((a, b) => b.done - a.done)
    .slice(0, 10)

  // Trend
  const buckets: Record<string, { created: number; completed: number }> = {}
  const bucketKey = (d: string) => {
    const dt = new Date(d)
    if (days <= 7) return dt.toISOString().slice(0, 10)
    if (days <= 30) return dt.toISOString().slice(0, 10)
    const week = new Date(dt); week.setDate(week.getDate() - week.getDay())
    return week.toISOString().slice(0, 10)
  }
  for (const t of tasks) {
    if (inPeriod(t.created_at)) {
      const k = bucketKey(t.created_at)
      if (!buckets[k]) buckets[k] = { created: 0, completed: 0 }
      buckets[k].created++
    }
    if (t.completed_at && inPeriod(t.completed_at)) {
      const k = bucketKey(t.completed_at)
      if (!buckets[k]) buckets[k] = { created: 0, completed: 0 }
      buckets[k].completed++
    }
  }
  const trend: TaskTrendPoint[] = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

  // Aging
  const aging: TaskAging = { d1: 0, d7: 0, d30: 0, d30plus: 0 }
  for (const t of openTasks) {
    const age = (now.getTime() - new Date(t.created_at).getTime()) / 86_400_000
    if (age < 1) aging.d1++
    else if (age < 7) aging.d7++
    else if (age < 30) aging.d30++
    else aging.d30plus++
  }

  const totalOpen      = openTasks.length
  const totalCompleted = completedPeriod.length
  const completionRate = (totalOpen + totalCompleted) > 0
    ? Math.round((totalCompleted / (totalOpen + totalCompleted)) * 100)
    : null

  return {
    period,
    totalOpen,
    totalOverdue: overdueTasks.length,
    totalCreatedInPeriod: periodTasks.length,
    totalCompletedInPeriod: totalCompleted,
    completionRate,
    netFlux: totalCompleted - periodTasks.length,
    avgCompletionHours,
    medianCompletionHours,
    byStatus,
    byPriority,
    byType,
    byTeam,
    agentLeaderboard,
    linkedToRequests: tasks.filter((t: any) => t.request_id).length,
    standalone: tasks.filter((t: any) => !t.request_id).length,
    trend,
    aging,
  }
}
