import { createAdminClient } from '@/lib/supabase/admin'
import type { ReportViewerScope } from '@/lib/reporting/access'
import { fetchAllPages } from '@/lib/queries/paging'
import { isCurrentlyBreached } from '@/lib/sla/breach'
import { AGE_BUCKETS, ageBucketFor } from '@/lib/reporting/aging'
import { RED_FLAG } from '@/lib/reporting/executive/engine'
import { loadStoreDims } from '@/lib/queries/store-dims'
import { momentOf } from '@/lib/analytics/moment'
import { applyScope } from '@/lib/queries/executive-dashboard'
import { istDay, istWeekStart } from '@/lib/reporting/ist'
import {
  emptyStoreFilter, matchesStoreFilter, storeFilterCount, toCombos, type StoreCombo, type StoreDims, type StoreFilter,
} from '@/lib/analytics/store-filter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type Period = '30d' | '60d' | '90d' | '120d' | 'fy'

/** The period buttons every dashboard offers, in order. "This FY" runs from 1 April of the current financial year to now. */
export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '30d', label: '30d' },
  { value: '60d', label: '60d' },
  { value: '90d', label: '90d' },
  { value: '120d', label: '120d' },
  { value: 'fy', label: 'This FY' },
]
export const isPeriod = (v: unknown): v is Period => PERIOD_OPTIONS.some((p) => p.value === v)

/** Start of the current financial year (1 April). */
function fyStart(now = new Date()): Date {
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return new Date(year, 3, 1)
}
function periodDays(p: Period): number {
  if (p === 'fy') {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.round((today.getTime() - fyStart().getTime()) / 86_400_000) + 1
  }
  return Number.parseInt(p, 10)
}

/** Explicit start/end date range (YYYY-MM-DD), for "custom" report windows. */
export type DateRange = { from: string; to: string }

export type PeriodParam = Period | DateRange

export function isDateRange(p: PeriodParam): p is DateRange {
  return typeof p === 'object'
}

export function periodStart(p: Period): Date {
  if (p === 'fy') return fyStart()
  const d = new Date()
  const days = periodDays(p)
  // N calendar days including today: today and the N-1 days before it (it used to start N days back, which is N+1 days)
  d.setDate(d.getDate() - (days - 1))
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
  const days = periodDays(p)
  const label = p === 'fy' ? 'this financial year' : `last ${days} days`
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
  /** of the tickets resolved in the period, those that had an SLA deadline (the base of the rate) */
  slaBase: number
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

/** One count per bucket in lib/reporting/aging.ts's AGE_BUCKETS, same order. */
/** The Store Master fields the dashboard can break the numbers down by. */
export type PlaceKey = 'region' | 'state' | 'cluster' | 'stype' | 'plist'
export type PlaceRow = {
  name: string
  created: number
  resolved: number
  openNow: number
  breachedNow: number
  slaBase: number
  slaCompliant: number
  slaRate: number | null
}
export type RedFlagStore = { code: string; name: string; region: string; cluster: string; acOpen: number; acTotal: number | null; acPct: number | null }
export type StoreSection = {
  /** what is chosen (the numbers on the page already follow it) */
  filter: StoreFilter
  /** tickets of the period per distinct store details, before the store choices: the filter pop-up works out its linked lists from these */
  combos: StoreCombo[]
  places: Record<PlaceKey, PlaceRow[]>
  summary: { storesWithTickets: number; redFlagCount: number; redFlagStores: RedFlagStore[]; nsoStores: number; nsoTickets: number }
}

export type BacklogAging = { bucket: string; label: string; count: number }[]

export type AnalyticsData = {
  period: PeriodParam
  periodLabel: string
  /** the period as the numbers were counted (epoch ms), so a click can open a list over exactly the same window */
  periodWindow: { start: number; end: number }
  /** the moment these numbers were counted (epoch ms): the page says so, and its pop-ups are read afresh when it changes */
  asOf: number
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
  // Today vs yesterday activity — independent of the period selector above
  dailyActivity: DailyActivity
  // Rolling 24h/7d/30d inflow (created) and outflow (closed) — also
  // independent of the period selector above
  requestFlow: RequestFlow
  // Store Master breakdown and the choices behind the store filter
  stores: StoreSection
  // Task KPIs
  tasksOpen: number
  tasksOverdue: number
  tasksDoneInPeriod: number
}

export type DailyStat = { today: number; yesterday: number }
export type DailyActivity = {
  pendingNow: number
  created: DailyStat
  closed: DailyStat
  assigned: DailyStat
}

// Cumulative rolling windows, each counting everything the shorter window
// already counts plus more (last7d includes last24h's requests, last30d
// includes last7d's) — matching how Zoho's own "Req. Inflow"/"Req. Outflow"
// cards read, rather than three mutually-exclusive buckets.
export type RollingStat = { last24h: number; last7d: number; last30d: number }
export type RequestFlow = { inflow: RollingStat; outflow: RollingStat }

// ── Main query ─────────────────────────────────────────────────────────────────


// A viewer who isn't org-wide only sees their own technician groups' data; no groups → nothing.
const NO_TEAM_ID = '00000000-0000-0000-0000-000000000000'

function scopeTeamIds(scope: ReportViewerScope): string[] | null {
  if (scope.kind === 'all') return null
  if (scope.kind === 'team' || scope.kind === 'agent') return scope.teamIds.length > 0 ? scope.teamIds : [NO_TEAM_ID]
  return [NO_TEAM_ID]
}

export async function getAnalytics(
  orgId: string,
  period: PeriodParam,
  scope: ReportViewerScope = { kind: 'all' },
  storeFilter: StoreFilter = emptyStoreFilter()
): Promise<AnalyticsData> {
  const teamScope = scopeTeamIds(scope)
  // a person's team (the people who report to them) is limited by who raised or works each ticket, not by technician group
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inScope = (q: any) => (scope.kind === 'reports' ? applyScope(q, scope, '') : teamScope ? q.in('team_id', teamScope) : q)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inTaskScope = (q: any) => (scope.kind === 'reports' ? q.in('assignee_id', scope.techIds && scope.techIds.length > 0 ? scope.techIds : scope.reportIds.length > 0 ? scope.reportIds : [NO_TEAM_ID]) : inScope(q))
  const admin = createAdminClient() as unknown as AnyClient
  const { start: startDate, end: endDate, label: periodLabel, days } = resolvePeriodParam(period)
  const start = startDate.toISOString()
  const end = endDate.toISOString()
  const now = new Date()

  // Reads every page of a query: PostgREST returns at most 1000 rows per request, and a bigger window used to be cut off silently.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageAll = async (build: (from: number, to: number) => any): Promise<{ data: any[] }> => {
    // D-019: an error on any page throws instead of returning the rows read so far
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { rows } = await fetchAllPages<any>(build, { maxRows: 200_000 })
    return { data: rows }
  }
  const withinScope = (q: any, col: string) => (scope.kind === 'reports' ? applyScope(q, scope, 'request.') : teamScope ? q.in(col, teamScope) : q) // eslint-disable-line @typescript-eslint/no-explicit-any

  // Today/yesterday window for the Daily Activity widget -- always the last
  // two calendar days regardless of the dashboard's own 7d/30d/90d/custom
  // period selector above, since "how many were created today" is an
  // absolute question, not one scoped to whatever range happens to be picked.
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)
  const yesterdayStartIso = yesterdayStart.toISOString()

  // Rolling windows for the Req. Inflow/Outflow cards — also absolute, not
  // scoped to the period selector. Calendar-day granularity (midnight N days
  // ago through now), matching the Daily Activity widget's own convention —
  // this keeps each card's headline number consistent with what its
  // click-through drawer shows (same day boundaries both places), rather
  // than a millisecond-precise rolling window the drawer can't reproduce.
  const daysAgoMidnight = (days: number) => {
    const d = new Date(todayStart)
    d.setDate(d.getDate() - days)
    return d
  }
  const last24hStartIso = yesterdayStart.toISOString() // "last 24h" ≈ today + yesterday
  const last7dStartIso = daysAgoMidnight(7).toISOString()
  const last30dStartIso = daysAgoMidnight(30).toISOString()

  // Run all fetches in parallel
  const [
    { data: periodRequests },
    { data: allOpen },
    { data: resolvedPeriod },
    { data: approvalRowsRaw },
    { data: teams },
    { data: services },
    { data: profiles },
    { data: tasks },
    { data: dailyCreatedRows },
    { data: dailyClosedRows },
    { data: dailyAssignedRows },
    storeLookup,
  ] = await Promise.all([
    // Requests created in period
    pageAll((from, to) => inScope(admin
      .from('requests')
      .select('id, requester_id, status, priority, team_id, service_id, assigned_to, created_at, resolved_at, responded_at, closed_at, resolution_due_at, response_due_at')
      .eq('org_id', orgId)
      .gte('created_at', start)
      .lte('created_at', end))
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),

    // All currently open requests (for backlog aging + SLA breached)
    pageAll((from, to) => inScope(admin
      .from('requests')
      .select('id, requester_id, status, priority, team_id, assigned_to, created_at, resolution_due_at, response_due_at, responded_at')
      .eq('org_id', orgId)
      .not('status', 'in', '("resolved","closed","cancelled")'))
      .order('id', { ascending: true }).range(from, to)),

    // Requests RESOLVED in the period, whenever they were created (resolved_at, else closed_at, else — for a ticket whose status says
    // resolved/closed but carries neither stamp — its last update). Resolved, SLA compliance and resolution time are counted over these.
    pageAll((from, to) => inScope(admin
      .from('requests')
      .select('id, requester_id, status, priority, team_id, assigned_to, created_at, resolved_at, closed_at, updated_at, resolution_due_at')
      .eq('org_id', orgId)
      .or(`and(resolved_at.gte.${start},resolved_at.lte.${end}),and(resolved_at.is.null,closed_at.gte.${start},closed_at.lte.${end}),and(resolved_at.is.null,closed_at.is.null,status.in.(resolved,closed),updated_at.gte.${start},updated_at.lte.${end})`))
      .order('id', { ascending: true }).range(from, to)),

    // Every approval request of the organisation (and its decisions) — whole-life, so "waiting" is what is pending right now
    pageAll((from, to) => withinScope(admin
      .from('approvals')
      .select('id, status, created_at, request_id, decisions:approval_decisions(decision, decided_at), request:requests!inner(org_id, team_id, requester_id)')
      .eq('request.org_id', orgId), 'request.team_id')
      .order('id', { ascending: true }).range(from, to)),

    // Teams lookup
    admin.from('teams').select('id, name').eq('org_id', orgId),

    // Services lookup
    admin.from('services').select('id, name').eq('org_id', orgId),

    // Profiles lookup (agents)
    admin.from('profiles').select('id, full_name, role').eq('org_id', orgId),

    // Tasks
    inTaskScope(admin
      .from('tasks')
      .select('id, status, priority, due_date, assignee_id, team_id, created_at, updated_at')
      .eq('org_id', orgId)),

    // Daily Activity (today/yesterday) + Req. Inflow/Outflow (24h/7d/30d) both
    // bucket off these same rows — fetched back to the widest window either
    // needs (30 days) so there's one created/closed query, not two.
    inScope(admin.from('requests').select('created_at, requester_id').eq('org_id', orgId).gte('created_at', last30dStartIso)),
    inScope(admin.from('requests').select('closed_at, requester_id').eq('org_id', orgId).not('closed_at', 'is', null).gte('closed_at', last30dStartIso)),
    pageAll((from, to) => withinScope(admin
      .from('request_activity')
      .select('created_at, request:requests!inner(org_id, team_id, requester_id)')
      .eq('action', 'assigned')
      .eq('request.org_id', orgId)
      .gte('created_at', yesterdayStartIso), 'request.team_id')
      .order('created_at', { ascending: true }).range(from, to)),

    // The Store Master details of every requester that is a store, to filter and break the numbers down by
    loadStoreDims(admin, orgId, now),
  ])

  const reqsAll = (periodRequests ?? []) as Array<{
    id: string; requester_id: string; status: string; priority: string; team_id: string; service_id: string
    assigned_to: string | null; created_at: string; resolved_at: string | null
    responded_at: string | null; closed_at: string | null
    resolution_due_at: string | null; response_due_at: string | null
  }>

  const openAll = (allOpen ?? []) as typeof reqsAll
  // The store choices narrow every number on the page (a requester with no store passes only when no store choice is made)
  const storeOf = (requesterId: string | null | undefined): StoreDims | null => (requesterId ? storeLookup.byRequester.get(requesterId) ?? null : null)
  const storeActive = storeFilterCount(storeFilter) > 0
  const keep = (requesterId: string | null | undefined) => !storeActive || matchesStoreFilter(storeOf(requesterId), storeFilter)
  const reqs = reqsAll.filter((r) => keep(r.requester_id))
  const open = openAll.filter((r) => keep(r.requester_id))
  // when a ticket was resolved: resolved_at, else closed_at, else (status says so) its last update
  type ResolvedRow = { id: string; requester_id: string; status: string; priority: string; team_id: string; assigned_to: string | null; created_at: string; resolved_at: string | null; closed_at: string | null; updated_at: string; resolution_due_at: string | null }
  const resolvedIn = ((resolvedPeriod ?? []) as ResolvedRow[]).filter((r) => keep(r.requester_id)).map((r) => ({ ...r, doneAt: (r.resolved_at ?? r.closed_at ?? r.updated_at) as string }))
  type ApprovalRaw = { id: string; status: string; created_at: string; request_id: string; request: { requester_id: string } | null; decisions: { decision: string; decided_at: string }[] | null }
  const approvalsAll = ((approvalRowsRaw ?? []) as ApprovalRaw[]).filter((a) => keep(a.request?.requester_id))
  const createdRows = ((dailyCreatedRows ?? []) as { created_at: string; requester_id: string }[]).filter((r) => keep(r.requester_id))
  const closedRows = ((dailyClosedRows ?? []) as { closed_at: string; requester_id: string }[]).filter((r) => keep(r.requester_id))
  const assignedRows = ((dailyAssignedRows ?? []) as { created_at: string; request: { requester_id: string } | null }[]).filter((r) => keep(r.request?.requester_id))
  const teamsArr = (teams ?? []) as Array<{ id: string; name: string }>
  const servicesArr = (services ?? []) as Array<{ id: string; name: string }>
  const profilesArr = (profiles ?? []) as Array<{ id: string; full_name: string; role: string }>
  const tasksArr = (tasks ?? []) as Array<{ id: string; status: string; priority: string; due_date: string | null; assignee_id: string | null; team_id: string | null; created_at: string; updated_at: string }>

  const teamMap = Object.fromEntries(teamsArr.map((t) => [t.id, t.name]))
  const serviceMap = Object.fromEntries(servicesArr.map((s) => [s.id, s.name]))
  const profileMap = Object.fromEntries(profilesArr.map((p) => [p.id, p.full_name]))

  // ── Volume ────────────────────────────────────────────────────────────────

  const totalCreated = reqs.length
  const totalResolved = resolvedIn.length
  const totalClosed = resolvedIn.filter((r) => r.status === 'closed').length
  const totalOpenNow = open.length
  const netFlux = totalResolved - totalCreated

  // ── SLA ───────────────────────────────────────────────────────────────────
  // Of the tickets resolved in the period that had a deadline, the share resolved on or before it.

  const resolvedWithSla = resolvedIn.filter((r) => r.resolution_due_at)
  const slaCompliant = resolvedWithSla.filter((r) => new Date(r.doneAt) <= new Date(r.resolution_due_at!))
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

  const { values: resolutionTatHours, anomalies: negativeResolutionDurationCount } = computeTatHours(
    resolvedIn.map((r) => ({ created_at: r.created_at, resolved_at: r.doneAt }))
  )

  const frtHours = reqs
    .filter((r) => r.responded_at)
    .map((r) => hours(r.created_at, r.responded_at!))

  const avgResolutionHours = avg(resolutionTatHours)
  const medianResolutionHours = median(resolutionTatHours)
  const avgFirstResponseHours = avg(frtHours)

  // ── By status ─────────────────────────────────────────────────────────────

  const statusCounts: Record<string, number> = {}
  reqs.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1 })
  const STATUS_ORDER = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval', 'resolved', 'closed', 'cancelled']
  const byStatus = STATUS_ORDER
    .filter((s) => statusCounts[s])
    .map((s) => ({ status: s, count: statusCounts[s] }))

  // ── By priority ───────────────────────────────────────────────────────────

  const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low']
  const byPriority: PriorityRow[] = PRIORITY_ORDER.map((priority) => {
    const group = reqs.filter((r) => r.priority === priority)
    const groupResolved = resolvedIn.filter((r) => r.priority === priority)
    const groupWithSla = groupResolved.filter((r) => r.resolution_due_at)
    const groupSlaOk = groupWithSla.filter((r) => new Date(r.doneAt) <= new Date(r.resolution_due_at!))
    const { values: groupTat } = computeTatHours(groupResolved.map((r) => ({ created_at: r.created_at, resolved_at: r.doneAt })))
    return {
      priority,
      count: group.length,
      resolved: groupResolved.length,
      slaBase: groupWithSla.length,
      slaCompliant: groupSlaOk.length,
      avgTatHours: avg(groupTat),
    }
  }).filter((r) => r.count > 0 || r.resolved > 0)

  // ── By team ───────────────────────────────────────────────────────────────

  const teamIds = [...new Set([...reqs.map((r) => r.team_id), ...resolvedIn.map((r) => r.team_id)])]
  const byTeam: TeamRow[] = teamIds.map((teamId) => {
    const group = reqs.filter((r) => r.team_id === teamId)
    const groupResolved = resolvedIn.filter((r) => r.team_id === teamId)
    const groupWithSla = groupResolved.filter((r) => r.resolution_due_at)
    const groupSlaOk = groupWithSla.filter((r) => new Date(r.doneAt) <= new Date(r.resolution_due_at!))
    const { values: groupTat } = computeTatHours(groupResolved.map((r) => ({ created_at: r.created_at, resolved_at: r.doneAt })))
    const openNow = open.filter((r) => r.team_id === teamId).length
    return {
      teamId,
      teamName: teamMap[teamId] ?? teamId,
      volume: group.length,
      resolved: groupResolved.length,
      slaRate: groupWithSla.length ? Math.round((groupSlaOk.length / groupWithSla.length) * 100) : null,
      avgTatHours: avg(groupTat),
      openNow,
    }
  }).sort((a, b) => b.volume - a.volume || b.resolved - a.resolved)

  // ── Agent leaderboard ─────────────────────────────────────────────────────

  const agentIds = [...new Set([
    ...reqs.filter((r) => r.assigned_to).map((r) => r.assigned_to!),
    ...open.filter((r) => r.assigned_to).map((r) => r.assigned_to!),
    ...resolvedIn.filter((r) => r.assigned_to).map((r) => r.assigned_to!),
  ])]

  const agentLeaderboard: AgentRow[] = agentIds
    .map((agentId) => {
      const groupResolved = resolvedIn.filter((r) => r.assigned_to === agentId)
      const { values: groupTat } = computeTatHours(groupResolved.map((r) => ({ created_at: r.created_at, resolved_at: r.doneAt })))
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

  // Counted per approval REQUEST (an approval with several steps counts once): waiting = pending right now; approved / rejected =
  // requests whose final decision fell in the period; rate = approved share of those; decision time = request → final decision.
  const finalOf = (a: ApprovalRaw) => {
    const last = [...(a.decisions ?? [])].sort((x, y) => new Date(x.decided_at).getTime() - new Date(y.decided_at).getTime()).pop()
    return a.status === 'pending' ? null : (last?.decided_at ?? a.created_at)
  }
  const decidedInPeriod = approvalsAll
    .map((a) => ({ a, at: finalOf(a) }))
    .filter((x): x is { a: ApprovalRaw; at: string } => x.at !== null && momentOf(x.at) >= startDate.getTime() && momentOf(x.at) <= endDate.getTime() && (x.a.status === 'approved' || x.a.status === 'rejected'))
  const approvalsApproved = decidedInPeriod.filter((x) => x.a.status === 'approved').length
  const approvalsRejected = decidedInPeriod.filter((x) => x.a.status === 'rejected').length
  const approvalsPending = approvalsAll.filter((a) => a.status === 'pending' && momentOf(a.created_at) <= endDate.getTime()).length
  const totalDecided = approvalsApproved + approvalsRejected
  const approvalRate = totalDecided ? Math.round((approvalsApproved / totalDecided) * 100) : null
  const avgApprovalCycleHours = avg(decidedInPeriod.map((x) => hours(x.a.created_at, x.at)))

  // ── Volume trend ──────────────────────────────────────────────────────────
  // Bucket by day for short windows, by week once the range gets long enough
  // that a daily chart would be unreadable (mirrors taskAnalytics's bucketing).

  const byWeek = days > 60
  const trendMap: Record<string, { created: number; resolved: number }> = {}
  // (a day is the India day, not the UTC day: a ticket created at 03:00 IST belongs to that day, not the day before)
  const bucketKey = (d: Date) => (byWeek ? istWeekStart(d) : istDay(d))
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
  })
  resolvedIn.forEach((r) => {
    const rday = bucketKey(new Date(r.doneAt))
    if (trendMap[rday]) trendMap[rday].resolved++
  })
  const trend: TrendPoint[] = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

  // ── Backlog aging ─────────────────────────────────────────────────────────

  const ageOf = (r: { created_at: string }) =>
    (now.getTime() - new Date(r.created_at).getTime()) / (1000 * 3600 * 24)

  const openBucketCounts = new Map<string, number>()
  for (const r of open) {
    const key = ageBucketFor(ageOf(r)).key
    openBucketCounts.set(key, (openBucketCounts.get(key) ?? 0) + 1)
  }
  const backlogAging: BacklogAging = AGE_BUCKETS.map((b) => ({
    bucket: b.key,
    label: b.label,
    count: openBucketCounts.get(b.key) ?? 0,
  }))

  // ── Daily Activity (today vs yesterday, always — not period-scoped) ────────

  const bucketByDay = (rows: { at: string }[]): DailyStat => {
    let today = 0, yesterday = 0
    for (const r of rows) {
      const t = momentOf(r.at)
      if (t >= todayStart.getTime()) today++
      else if (t >= yesterdayStart.getTime()) yesterday++
    }
    return { today, yesterday }
  }
  const dailyActivity: DailyActivity = {
    pendingNow: totalOpenNow,
    created: bucketByDay(createdRows.map((r) => ({ at: r.created_at }))),
    closed: bucketByDay(closedRows.map((r) => ({ at: r.closed_at }))),
    assigned: bucketByDay(assignedRows.map((r) => ({ at: r.created_at }))),
  }

  // ── Req. Inflow / Outflow (rolling 24h/7d/30d, cumulative) ─────────────────

  const bucketByRollingWindow = (rows: { at: string }[]): RollingStat => {
    let last24h = 0, last7d = 0, last30d = 0
    for (const r of rows) {
      const t = momentOf(r.at)
      if (t >= Date.parse(last30dStartIso)) last30d++
      if (t >= Date.parse(last7dStartIso)) last7d++
      if (t >= Date.parse(last24hStartIso)) last24h++
    }
    return { last24h, last7d, last30d }
  }
  const requestFlow: RequestFlow = {
    inflow: bucketByRollingWindow(createdRows.map((r) => ({ at: r.created_at }))),
    outflow: bucketByRollingWindow(closedRows.map((r) => ({ at: r.closed_at }))),
  }

  // ── Store Master: the numbers by region / state / cluster / store type / priority list, and the stores that need a look ──

  const placeKeys: PlaceKey[] = ['region', 'state', 'cluster', 'stype', 'plist']
  const placesOut = {} as Record<PlaceKey, PlaceRow[]>
  for (const k of placeKeys) {
    const rows = new Map<string, PlaceRow>()
    const row = (requesterId: string) => {
      const name = storeOf(requesterId)?.[k] ?? '(No store)'
      let r = rows.get(name)
      if (!r) { r = { name, created: 0, resolved: 0, openNow: 0, breachedNow: 0, slaBase: 0, slaCompliant: 0, slaRate: null }; rows.set(name, r) }
      return r
    }
    reqs.forEach((r) => { row(r.requester_id).created++ })
    resolvedIn.forEach((r) => {
      const x = row(r.requester_id)
      x.resolved++
      if (r.resolution_due_at) { x.slaBase++; if (new Date(r.doneAt) <= new Date(r.resolution_due_at)) x.slaCompliant++ }
    })
    open.forEach((r) => { const x = row(r.requester_id); x.openNow++; if (isCurrentlyBreached(r, now)) x.breachedNow++ })
    placesOut[k] = [...rows.values()]
      .map((r) => ({ ...r, slaRate: r.slaBase ? Math.round((r.slaCompliant / r.slaBase) * 100) : null }))
      .sort((a, b) => b.created - a.created || b.openNow - a.openNow || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }
  const seenStores = new Map<string, StoreDims>()
  for (const r of [...reqs, ...open]) { const d = storeOf(r.requester_id); if (d) seenStores.set(d.code, d) }
  const redFlag = [...seenStores.values()].filter((d) => d.ac === RED_FLAG).sort((a, b) => (b.acPct ?? 0) - (a.acPct ?? 0) || a.code.localeCompare(b.code))
  const storeSection: StoreSection = {
    filter: storeFilter,
    combos: toCombos(reqsAll.map((r) => storeOf(r.requester_id)).filter((d): d is StoreDims => d !== null)),
    places: placesOut,
    summary: {
      storesWithTickets: seenStores.size,
      redFlagCount: redFlag.length,
      redFlagStores: redFlag.slice(0, 8).map((d) => ({ code: d.code, name: d.name, region: d.region, cluster: d.cluster, acOpen: d.acOpen, acTotal: d.acTotal, acPct: d.acPct })),
      nsoStores: [...seenStores.values()].filter((d) => d.stype === 'NSO').length,
      nsoTickets: reqs.filter((r) => storeOf(r.requester_id)?.stype === 'NSO').length,
    },
  }

  // ── Task KPIs ─────────────────────────────────────────────────────────────

  const tasksOpen = tasksArr.filter((t) => !['done', 'cancelled'].includes(t.status)).length
  const tasksOverdue = tasksArr.filter(
    (t) => t.due_date && new Date(t.due_date) < now && !['done', 'cancelled'].includes(t.status)
  ).length
  const tasksDoneInPeriod = tasksArr.filter(
    (t) => t.status === 'done' && momentOf(t.updated_at) >= startDate.getTime() && momentOf(t.updated_at) <= endDate.getTime()
  ).length

  return {
    period,
    periodLabel,
    periodWindow: { start: startDate.getTime(), end: endDate.getTime() },
    asOf: now.getTime(),
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
    dailyActivity,
    requestFlow,
    stores: storeSection,
    tasksOpen,
    tasksOverdue,
    tasksDoneInPeriod,
  }
}
