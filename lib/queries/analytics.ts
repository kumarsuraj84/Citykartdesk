import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentlyBreached } from '@/lib/sla/breach'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type Period = '7d' | '30d' | '90d'

/** Explicit start/end date range (YYYY-MM-DD), for "custom" report windows. */
export type DateRange = { from: string; to: string }

export type PeriodParam = Period | DateRange

export function isDateRange(p: PeriodParam): p is DateRange {
  return typeof p === 'object'
}

export function periodStart(p: Period): Date {
  const d = new Date()
  const days = p === '7d' ? 7 : p === '30d' ? 30 : 90
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Resolves a preset period or a custom range into a concrete window + display label. */
export function resolvePeriodParam(p: PeriodParam): { start: Date; end: Date; label: string; days: number } {
  if (isDateRange(p)) {
    const start = new Date(`${p.from}T00:00:00`)
    const end = new Date(`${p.to}T23:59:59.999`)
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
    return { start, end, label: `${shortDate(start)} – ${shortDate(end)}`, days }
  }
  const days = p === '7d' ? 7 : p === '30d' ? 30 : 90
  const label = p === '7d' ? 'last 7 days' : p === '30d' ? 'last 30 days' : 'last 90 days'
  return { start: periodStart(p), end: new Date(), label, days }
}

function hours(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 3600)
}

/** Turnaround-time hours for a set of resolved-ish rows, excluding any row
 *  whose duration is not a valid business state (resolved_at earlier than
 *  created_at, or a non-finite timestamp). A negative/NaN duration can only
 *  come from bad data — clock skew, a backdated import, or a malformed
 *  fixture — never from a real request lifecycle, since every write path
 *  sets resolved_at to "now" at the moment of transition (lib/actions/requests.ts).
 *  Excluding these rows (rather than clamping them to 0, which would quietly
 *  understate TAT and mask the anomaly) keeps every avg/median/group figure
 *  built from this one guarded source. `anomalies` lets the caller surface a
 *  diagnosable count instead of a silently wrong number. */
export function computeTatHours(
  rows: Array<{ created_at: string; resolved_at?: string | null }>
): { values: number[]; anomalies: number } {
  const values: number[] = []
  let anomalies = 0
  for (const r of rows) {
    if (!r.resolved_at) continue
    const h = hours(r.created_at, r.resolved_at)
    if (!Number.isFinite(h) || h < 0) {
      anomalies++
      continue
    }
    values.push(h)
  }
  return { values, anomalies }
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
  period: PeriodParam
  periodLabel: string
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
  // Data-quality guard (see computeTatHours) — count of resolved requests
  // excluded from every TAT figure above because resolved_at was earlier
  // than created_at (impossible business state, always a data anomaly).
  dataAnomalies: { negativeResolutionDurationCount: number }
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

export async function getAnalytics(orgId: string, period: PeriodParam): Promise<AnalyticsData> {
  const admin = createAdminClient() as unknown as AnyClient
  const { start: startDate, end: endDate, label: periodLabel, days } = resolvePeriodParam(period)
  const start = startDate.toISOString()
  const end = endDate.toISOString()
  const now = new Date()

  // approvals/approval_decisions have no org_id column of their own — scoped
  // via requests.org_id, resolved as id sets up front (admin client bypasses
  // RLS, so this org boundary must be enforced here explicitly, not left to
  // the DB). Not period-windowed: an approval/decision inside the reporting
  // window can reference a request created well before it.
  const { data: orgRequestIdRows } = await admin.from('requests').select('id').eq('org_id', orgId)
  const orgRequestIds = (orgRequestIdRows ?? []).map((r: { id: string }) => r.id)
  const { data: orgApprovalIdRows } = orgRequestIds.length > 0
    ? await admin.from('approvals').select('id').in('request_id', orgRequestIds)
    : { data: [] as { id: string }[] }
  const orgApprovalIds = (orgApprovalIdRows ?? []).map((a: { id: string }) => a.id)

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
      .eq('org_id', orgId)
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: true }),

    // All currently open requests (for backlog aging + SLA breached)
    admin
      .from('requests')
      .select('id, status, priority, team_id, assigned_to, created_at, resolution_due_at, response_due_at, responded_at')
      .eq('org_id', orgId)
      .not('status', 'in', '("resolved","closed","cancelled")'),

    // Approval decisions in period
    orgApprovalIds.length > 0
      ? admin
          .from('approval_decisions')
          .select('id, approval_id, decision, decided_at')
          .in('approval_id', orgApprovalIds)
          .gte('decided_at', start)
          .lte('decided_at', end)
      : Promise.resolve({ data: [] }),

    // All approvals
    orgRequestIds.length > 0
      ? admin
          .from('approvals')
          .select('id, status, created_at, request_id')
          .in('request_id', orgRequestIds)
          .gte('created_at', start)
          .lte('created_at', end)
      : Promise.resolve({ data: [] }),

    // Teams lookup
    admin.from('teams').select('id, name').eq('org_id', orgId),

    // Services lookup
    admin.from('services').select('id, name').eq('org_id', orgId),

    // Profiles lookup (agents)
    admin.from('profiles').select('id, full_name, role').eq('org_id', orgId),

    // Tasks
    admin
      .from('tasks')
      .select('id, status, priority, due_date, assignee_id, team_id, created_at, updated_at')
      .eq('org_id', orgId),
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

  // "Currently Breached" (D-01, lib/sla/breach.ts) — open is already
  // pre-filtered to exclude resolved/closed/cancelled (query above), so
  // isCurrentlyBreached's own status check is redundant here but keeps this
  // call site correct on its own even if that upstream filter ever changes.
  const slaBreachedNow = open.filter((r) => isCurrentlyBreached(r, now)).length

  const frtBreachedNow = open.filter(
    (r) => !r.responded_at && r.response_due_at && new Date(r.response_due_at) < now
  ).length

  // ── TAT ───────────────────────────────────────────────────────────────────

  const { values: resolutionTatHours, anomalies: negativeResolutionDurationCount } = computeTatHours(resolved)

  const frtHours = reqs
    .filter((r) => r.responded_at)
    .map((r) => hours(r.created_at, r.responded_at!))

  const avgResolutionHours = avg(resolutionTatHours)
  const medianResolutionHours = median(resolutionTatHours)
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
    const { values: groupTat } = computeTatHours(groupResolved)
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
    const { values: groupTat } = computeTatHours(groupResolved)
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
      const { values: groupTat } = computeTatHours(groupResolved)
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
  // Bucket by day for short windows, by week once the range gets long enough
  // that a daily chart would be unreadable (mirrors taskAnalytics's bucketing).

  const byWeek = days > 60
  const trendMap: Record<string, { created: number; resolved: number }> = {}
  const bucketKey = (d: Date) => {
    if (!byWeek) return d.toISOString().slice(0, 10)
    const week = new Date(d)
    week.setDate(week.getDate() - week.getDay())
    return week.toISOString().slice(0, 10)
  }
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    if (d > endDate) break
    const key = bucketKey(d)
    if (!trendMap[key]) trendMap[key] = { created: 0, resolved: 0 }
  }
  reqs.forEach((r) => {
    const day = bucketKey(new Date(r.created_at))
    if (trendMap[day]) trendMap[day].created++
    if (r.resolved_at) {
      const rday = bucketKey(new Date(r.resolved_at))
      if (trendMap[rday]) trendMap[rday].resolved++
    }
  })
  const trend: TrendPoint[] = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

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
    (t) => t.status === 'done' && t.updated_at >= start && t.updated_at <= end
  ).length

  return {
    period,
    periodLabel,
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
    dataAnomalies: { negativeResolutionDurationCount },
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
