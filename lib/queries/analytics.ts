import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type Period = '7d' | '30d' | '90d'

export function periodStart(p: Period): Date {
  const d = new Date()
  const days = p === '7d' ? 7 : p === '30d' ? 30 : 90
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d
}

function hours(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 3600)
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type TrendPoint = { date: string; created: number; resolved: number }

export type PriorityRow = {
  priority: string
  count: number
  resolved: number
  slaCompliant: number
  avgTatHours: number | null
}

export type TeamRow = {
  teamId: string
  teamName: string
  volume: number
  resolved: number
  slaRate: number | null
  avgTatHours: number | null
  openNow: number
}

export type AgentRow = {
  agentId: string
  agentName: string
  resolved: number
  openNow: number
  avgTatHours: number | null
}

export type ServiceRow = { name: string; count: number }

export type BacklogAging = { d1: number; d7: number; d30: number; d30plus: number }

export type AnalyticsData = {
  period: Period
  // Volume
  totalCreated: number
  totalResolved: number
  totalClosed: number
  totalOpenNow: number
  netFlux: number          // resolved - created (positive = shrinking backlog)
  // SLA
  slaComplianceRate: number | null
  frtComplianceRate: number | null
  slaBreachedNow: number
  frtBreachedNow: number
  // TAT
  avgResolutionHours: number | null
  medianResolutionHours: number | null
  avgFirstResponseHours: number | null
  // Distributions
  byStatus: Array<{ status: string; count: number }>
  byPriority: PriorityRow[]
  // Team & agent
  byTeam: TeamRow[]
  agentLeaderboard: AgentRow[]
  // Services
  topServices: ServiceRow[]
  // Approval funnel
  approvalsApproved: number
  approvalsRejected: number
  approvalsPending: number
  approvalRate: number | null
  avgApprovalCycleHours: number | null
  // Trend
  trend: TrendPoint[]
  // Backlog aging (open tickets only)
  backlogAging: BacklogAging
  // Task KPIs
  tasksOpen: number
  tasksOverdue: number
  tasksDoneInPeriod: number
}

// ── Main query ─────────────────────────────────────────────────────────────────

export async function getAnalytics(period: Period): Promise<AnalyticsData> {
  const admin = createAdminClient() as unknown as AnyClient
  const start = periodStart(period).toISOString()
  const now = new Date()
  const nowIso = now.toISOString()

  // Run all fetches in parallel
  const [
    { data: periodRequests },
    { data: allOpen },
    { data: approvalDecisions },
    { data: approvals },
    { data: teams },
    { data: services },
    { data: profiles },
    { data: tasks },
  ] = await Promise.all([
    // Requests created in period
    admin
      .from('requests')
      .select('id, status, priority, team_id, service_id, assigned_to, created_at, resolved_at, responded_at, closed_at, resolution_due_at, response_due_at')
      .gte('created_at', start)
      .order('created_at', { ascending: true }),

    // All currently open requests (for backlog aging + SLA breached)
    admin
      .from('requests')
      .select('id, status, priority, team_id, assigned_to, created_at, resolution_due_at, response_due_at, responded_at')
      .not('status', 'in', '("resolved","closed","cancelled")'),

    // Approval decisions in period
    admin
      .from('approval_decisions')
      .select('id, approval_id, decision, decided_at')
      .gte('decided_at', start),

    // All approvals
    admin
      .from('approvals')
      .select('id, status, created_at, request_id')
      .gte('created_at', start),

    // Teams lookup
    admin.from('teams').select('id, name'),

    // Services lookup
    admin.from('services').select('id, name'),

    // Profiles lookup (agents)
    admin.from('profiles').select('id, full_name, role'),

    // Tasks
    admin
      .from('tasks')
      .select('id, status, priority, due_date, assignee_id, team_id, created_at, updated_at'),
  ])

  const reqs = (periodRequests ?? []) as Array<{
    id: string; status: string; priority: string; team_id: string; service_id: string
    assigned_to: string | null; created_at: string; resolved_at: string | null
    responded_at: string | null; closed_at: string | null
    resolution_due_at: string | null; response_due_at: string | null
  }>

  const open = (allOpen ?? []) as typeof reqs
  const decisions = (approvalDecisions ?? []) as Array<{ id: string; approval_id: string; decision: string; decided_at: string }>
  const approvalsArr = (approvals ?? []) as Array<{ id: string; status: string; created_at: string; request_id: string }>
  const teamsArr = (teams ?? []) as Array<{ id: string; name: string }>
  const servicesArr = (services ?? []) as Array<{ id: string; name: string }>
  const profilesArr = (profiles ?? []) as Array<{ id: string; full_name: string; role: string }>
  const tasksArr = (tasks ?? []) as Array<{ id: string; status: string; priority: string; due_date: string | null; assignee_id: string | null; team_id: string | null; created_at: string; updated_at: string }>

  const teamMap = Object.fromEntries(teamsArr.map((t) => [t.id, t.name]))
  const serviceMap = Object.fromEntries(servicesArr.map((s) => [s.id, s.name]))
  const profileMap = Object.fromEntries(profilesArr.map((p) => [p.id, p.full_name]))
  const approvalMap = Object.fromEntries(approvalsArr.map((a) => [a.id, a]))

  // ── Volume ────────────────────────────────────────────────────────────────

  const totalCreated = reqs.length
  const resolved = reqs.filter((r) => r.resolved_at || r.status === 'resolved' || r.status === 'closed')
  const totalResolved = resolved.length
  const totalClosed = reqs.filter((r) => r.status === 'closed').length
  const totalOpenNow = open.length
  const netFlux = totalResolved - totalCreated

  // ── SLA ───────────────────────────────────────────────────────────────────

  const resolvedWithSla = resolved.filter((r) => r.resolution_due_at && r.resolved_at)
  const slaCompliant = resolvedWithSla.filter(
    (r) => new Date(r.resolved_at!) <= new Date(r.resolution_due_at!)
  )
  const slaComplianceRate = resolvedWithSla.length
    ? Math.round((slaCompliant.length / resolvedWithSla.length) * 100)
    : null

  const respondedWithSla = reqs.filter((r) => r.responded_at && r.response_due_at)
  const frtCompliant = respondedWithSla.filter(
    (r) => new Date(r.responded_at!) <= new Date(r.response_due_at!)
  )
  const frtComplianceRate = respondedWithSla.length
    ? Math.round((frtCompliant.length / respondedWithSla.length) * 100)
    : null

  const slaBreachedNow = open.filter(
    (r) => r.resolution_due_at && new Date(r.resolution_due_at) < now
  ).length

  const frtBreachedNow = open.filter(
    (r) => !r.responded_at && r.response_due_at && new Date(r.response_due_at) < now
  ).length

  // ── TAT ───────────────────────────────────────────────────────────────────

  const tatHours = resolved
    .filter((r) => r.resolved_at)
    .map((r) => hours(r.created_at, r.resolved_at!))

  const frtHours = reqs
    .filter((r) => r.responded_at)
    .map((r) => hours(r.created_at, r.responded_at!))

  const avgResolutionHours = avg(tatHours)
  const medianResolutionHours = median(tatHours)
  const avgFirstResponseHours = avg(frtHours)

  // ── By status ─────────────────────────────────────────────────────────────

  const statusCounts: Record<string, number> = {}
  reqs.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1 })
  const STATUS_ORDER = ['open', 'assigned', 'in_progress', 'waiting_user', 'pending_approval', 'resolved', 'closed', 'cancelled']
  const byStatus = STATUS_ORDER
    .filter((s) => statusCounts[s])
    .map((s) => ({ status: s, count: statusCounts[s] }))

  // ── By priority ───────────────────────────────────────────────────────────

  const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low']
  const byPriority: PriorityRow[] = PRIORITY_ORDER.map((priority) => {
    const group = reqs.filter((r) => r.priority === priority)
    const groupResolved = group.filter((r) => r.resolved_at)
    const groupSlaOk = groupResolved.filter(
      (r) => r.resolution_due_at && new Date(r.resolved_at!) <= new Date(r.resolution_due_at!)
    )
    const groupTat = groupResolved.map((r) => hours(r.created_at, r.resolved_at!))
    return {
      priority,
      count: group.length,
      resolved: groupResolved.length,
      slaCompliant: groupSlaOk.length,
      avgTatHours: avg(groupTat),
    }
  }).filter((r) => r.count > 0)

  // ── By team ───────────────────────────────────────────────────────────────

  const teamIds = [...new Set(reqs.map((r) => r.team_id))]
  const byTeam: TeamRow[] = teamIds.map((teamId) => {
    const group = reqs.filter((r) => r.team_id === teamId)
    const groupResolved = group.filter((r) => r.resolved_at)
    const groupSlaOk = groupResolved.filter(
      (r) => r.resolution_due_at && new Date(r.resolved_at!) <= new Date(r.resolution_due_at!)
    )
    const groupTat = groupResolved.map((r) => hours(r.created_at, r.resolved_at!))
    const openNow = open.filter((r) => r.team_id === teamId).length
    return {
      teamId,
      teamName: teamMap[teamId] ?? teamId,
      volume: group.length,
      resolved: groupResolved.length,
      slaRate: groupResolved.length ? Math.round((groupSlaOk.length / groupResolved.length) * 100) : null,
      avgTatHours: avg(groupTat),
      openNow,
    }
  }).sort((a, b) => b.volume - a.volume)

  // ── Agent leaderboard ─────────────────────────────────────────────────────

  const agentIds = [...new Set([
    ...reqs.filter((r) => r.assigned_to).map((r) => r.assigned_to!),
    ...open.filter((r) => r.assigned_to).map((r) => r.assigned_to!),
  ])]

  const agentLeaderboard: AgentRow[] = agentIds
    .map((agentId) => {
      const groupResolved = resolved.filter((r) => r.assigned_to === agentId && r.resolved_at)
      const groupTat = groupResolved.map((r) => hours(r.created_at, r.resolved_at!))
      const openNow = open.filter((r) => r.assigned_to === agentId).length
      return {
        agentId,
        agentName: profileMap[agentId] ?? 'Unknown',
        resolved: groupResolved.length,
        openNow,
        avgTatHours: avg(groupTat),
      }
    })
    .sort((a, b) => b.resolved - a.resolved)
    .slice(0, 10)

  // ── Top services ──────────────────────────────────────────────────────────

  const svcCounts: Record<string, number> = {}
  reqs.forEach((r) => {
    const name = serviceMap[r.service_id] ?? 'Unknown'
    svcCounts[name] = (svcCounts[name] ?? 0) + 1
  })
  const topServices: ServiceRow[] = Object.entries(svcCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  // ── Approval analytics ────────────────────────────────────────────────────

  const approvalsApproved = decisions.filter((d) => d.decision === 'approved').length
  const approvalsRejected = decisions.filter((d) => d.decision === 'rejected').length
  const approvalsPending = approvalsArr.filter((a) => a.status === 'pending').length
  const totalDecided = approvalsApproved + approvalsRejected
  const approvalRate = totalDecided ? Math.round((approvalsApproved / totalDecided) * 100) : null

  const cycleTimes = decisions
    .filter((d) => approvalMap[d.approval_id])
    .map((d) => hours(approvalMap[d.approval_id].created_at, d.decided_at))
  const avgApprovalCycleHours = avg(cycleTimes)

  // ── Volume trend ──────────────────────────────────────────────────────────

  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  const trendMap: Record<string, { created: number; resolved: number }> = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    trendMap[key] = { created: 0, resolved: 0 }
  }
  reqs.forEach((r) => {
    const day = r.created_at.slice(0, 10)
    if (trendMap[day]) trendMap[day].created++
    if (r.resolved_at) {
      const rday = r.resolved_at.slice(0, 10)
      if (trendMap[rday]) trendMap[rday].resolved++
    }
  })
  const trend: TrendPoint[] = Object.entries(trendMap).map(([date, v]) => ({ date, ...v }))

  // ── Backlog aging ─────────────────────────────────────────────────────────

  const ageOf = (r: { created_at: string }) =>
    (now.getTime() - new Date(r.created_at).getTime()) / (1000 * 3600 * 24)

  const backlogAging: BacklogAging = {
    d1:     open.filter((r) => ageOf(r) < 1).length,
    d7:     open.filter((r) => ageOf(r) >= 1 && ageOf(r) < 7).length,
    d30:    open.filter((r) => ageOf(r) >= 7 && ageOf(r) < 30).length,
    d30plus: open.filter((r) => ageOf(r) >= 30).length,
  }

  // ── Task KPIs ─────────────────────────────────────────────────────────────

  const tasksOpen = tasksArr.filter((t) => !['done', 'cancelled'].includes(t.status)).length
  const tasksOverdue = tasksArr.filter(
    (t) => t.due_date && new Date(t.due_date) < now && !['done', 'cancelled'].includes(t.status)
  ).length
  const tasksDoneInPeriod = tasksArr.filter(
    (t) => t.status === 'done' && t.updated_at >= start
  ).length

  return {
    period,
    totalCreated,
    totalResolved,
    totalClosed,
    totalOpenNow,
    netFlux,
    slaComplianceRate,
    frtComplianceRate,
    slaBreachedNow,
    frtBreachedNow,
    avgResolutionHours,
    medianResolutionHours,
    avgFirstResponseHours,
    byStatus,
    byPriority,
    byTeam,
    agentLeaderboard,
    topServices,
    approvalsApproved,
    approvalsRejected,
    approvalsPending,
    approvalRate,
    avgApprovalCycleHours,
    trend,
    backlogAging,
    tasksOpen,
    tasksOverdue,
    tasksDoneInPeriod,
  }
}
