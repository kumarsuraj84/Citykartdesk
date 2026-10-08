import { createAdminClient } from '@/lib/supabase/admin'
import { buildAgeSummary, UNASSIGNED, NO_CATEGORY, NO_SUB_CATEGORY, type AgeSummary, type SummaryInputRow, type DayInputRow } from '@/lib/reporting/analytics/age-summary'
import { ageBucketLabel } from '@/lib/reporting/aging'
import { sortDetailRows, filterDetailRows, technicianOptions, bucketOptions, type DetailRow } from '@/lib/reporting/analytics/ticket-detail'
import {
  ANALYTICS_REPORTS, findAnalyticsReport, canUseReportAnalytics, selectableGroups, pickGroup, type AnalyticsReportDef,
} from '@/lib/reporting/analytics/catalog'
import { resolveDateRange, referenceDay, type ResolvedRange, type ReferenceDay } from '@/lib/reporting/analytics/date-ranges'
import type { ProfileWithTeams, RequestStatus } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const PAGE = 1000
/** Safety cap — a technician group's tickets never get near this; it only stops a runaway query. */
const MAX_TICKETS = 50_000

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

export interface OrgTeam { id: string; name: string }
export interface GroupService { id: string; name: string }

/** The organisation's active technician groups. */
export async function getOrgTeams(orgId: string): Promise<OrgTeam[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin.from('teams').select('id, name').eq('org_id', orgId).eq('is_active', true)
  return (data ?? []) as OrgTeam[]
}

/** The services that belong to a technician group (one group can run several). */
export async function getGroupServices(orgId: string, teamId: string): Promise<GroupService[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin.from('services').select('id, name').eq('org_id', orgId).eq('team_id', teamId).order('name', { ascending: true })
  return (data ?? []) as GroupService[]
}

/** The predefined reports a viewer can open (none when they belong to no technician group and are not an admin/owner). */
export async function listReportsForViewer(profile: ProfileWithTeams): Promise<AnalyticsReportDef[]> {
  if (!profile.org_id || !canUseReportAnalytics(profile.role)) return []
  const groups = selectableGroups(profile, await getOrgTeams(profile.org_id))
  return groups.length > 0 ? ANALYTICS_REPORTS : []
}

interface TicketRow {
  created_at: string
  resolved_at: string | null
  closed_at: string | null
  category: { name: string } | null
  sub_category: { name: string } | null
  assignee: { full_name: string } | null
}

const SELECT = 'created_at, resolved_at, closed_at, category:service_categories(name), sub_category:service_sub_categories(name), assignee:profiles!requests_assigned_to_fkey(full_name)'

/** Pages through a query until it runs out (PostgREST returns at most 1000 rows per request). */
async function fetchAll<T = TicketRow>(build: (from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  let truncated = false
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await build(offset, offset + PAGE - 1)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) break
    if (rows.length >= MAX_TICKETS) { truncated = true; break }
  }
  return { rows, truncated }
}

/** Every ticket of one technician group created in the range, in the given statuses (and services), as summary input rows. */
async function fetchGroupTickets(
  orgId: string, teamId: string, range: ResolvedRange, statuses: RequestStatus[], serviceIds: string[] | null
): Promise<{ rows: SummaryInputRow[]; truncated: boolean }> {
  const admin = createAdminClient() as unknown as AnyClient
  const now = new Date().toISOString()
  const { rows, truncated } = await fetchAll((from, to) => {
    let q = admin.from('requests').select(SELECT).eq('org_id', orgId).eq('team_id', teamId).in('status', statuses)
    if (serviceIds) q = q.in('service_id', serviceIds)
    if (range.from) q = q.gte('created_at', range.from.toISOString())
    if (range.to) q = q.lte('created_at', range.to.toISOString())
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  })
  return {
    truncated,
    rows: rows.map((r) => ({
      technician: r.assignee?.full_name ?? null,
      category: r.category?.name ?? null,
      subCategory: r.sub_category?.name ?? null,
      // Same age rule as Report Builder: still open → age so far; resolved/closed → time it took.
      ageDays: daysBetween(r.created_at, r.resolved_at ?? r.closed_at ?? now),
    })),
  }
}

/**
 * Tickets of the group that were created or resolved on the reference day — whatever their
 * status now, so "resolved today" works even though resolved tickets are hidden by the default Status filter.
 */
async function fetchDayActivity(orgId: string, teamId: string, day: ReferenceDay, serviceIds: string[] | null): Promise<DayInputRow[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const a = day.start.toISOString()
  const b = day.end.toISOString()
  const { rows } = await fetchAll((from, to) => {
    let q = admin.from('requests').select(SELECT).eq('org_id', orgId).eq('team_id', teamId)
      .or(`and(created_at.gte.${a},created_at.lte.${b}),and(resolved_at.gte.${a},resolved_at.lte.${b})`)
    if (serviceIds) q = q.in('service_id', serviceIds)
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  })
  const within = (iso: string | null) => !!iso && iso >= a && iso <= b
  return rows.map((r) => ({
    technician: r.assignee?.full_name ?? null,
    category: r.category?.name ?? null,
    subCategory: r.sub_category?.name ?? null,
    created: within(r.created_at),
    resolved: within(r.resolved_at),
  }))
}

export interface AgeBucketReportResult {
  def: AnalyticsReportDef
  /** The group being shown. */
  team: OrgTeam
  /** Every group this viewer can choose from (A→Z). */
  groups: OrgTeam[]
  /** The chosen group's services, and which of them are included. */
  services: GroupService[]
  selectedServiceIds: string[]
  range: ResolvedRange
  /** The day the "created / resolved that day" columns are about. */
  day: ReferenceDay
  statuses: RequestStatus[]
  summary: AgeSummary
  ticketCount: number
  truncated: boolean
}

interface ReportScope {
  def: AnalyticsReportDef
  team: OrgTeam
  groups: OrgTeam[]
  services: GroupService[]
  selectedServiceIds: string[]
  /** null = every service (no filter) */
  serviceIds: string[] | null
  range: ResolvedRange
}

/** Who may open which report, which group it is about, which services and dates are included — shared by every report. */
async function resolveScope(
  profile: ProfileWithTeams,
  slug: string,
  kind: AnalyticsReportDef['kind'],
  filters: { group?: string; services?: string[]; preset?: string; from?: string; to?: string }
): Promise<{ error: string } | ReportScope> {
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!canUseReportAnalytics(profile.role)) return { error: "You don't have access to this report." }
  const def = findAnalyticsReport(slug)
  if (!def || def.kind !== kind) return { error: 'This report does not exist.' }

  const groups = selectableGroups(profile, await getOrgTeams(profile.org_id))
  const team = pickGroup(groups, filters.group)
  if (!team) return { error: "You don't belong to a technician group yet, so there is no group to report on." }

  // Only services that really belong to this group count (a service picked for another group is ignored);
  // choosing none, or all of them, means "every service" — no filter, so tickets without a service still show.
  const services = await getGroupServices(profile.org_id, team.id)
  const wanted = new Set(filters.services ?? [])
  const chosen = services.filter((s) => wanted.has(s.id))
  const useFilter = chosen.length > 0 && chosen.length < services.length
  return {
    def, team, groups, services,
    selectedServiceIds: useFilter ? chosen.map((s) => s.id) : services.map((s) => s.id),
    serviceIds: useFilter ? chosen.map((s) => s.id) : null,
    range: resolveDateRange(filters.preset, filters.from, filters.to),
  }
}

/** Loads the summary report for a viewer, or says why they cannot have it. */
export async function loadAgeBucketReport(
  profile: ProfileWithTeams,
  slug: string,
  filters: { group?: string; services?: string[]; preset?: string; from?: string; to?: string; statuses: RequestStatus[] }
): Promise<{ error: string } | AgeBucketReportResult> {
  const scope = await resolveScope(profile, slug, 'age-summary', filters)
  if ('error' in scope) return scope
  const day = referenceDay(scope.range)
  const [{ rows, truncated }, dayRows] = await Promise.all([
    fetchGroupTickets(profile.org_id!, scope.team.id, scope.range, filters.statuses, scope.serviceIds),
    fetchDayActivity(profile.org_id!, scope.team.id, day, scope.serviceIds),
  ])
  return {
    def: scope.def, team: scope.team, groups: scope.groups, services: scope.services,
    selectedServiceIds: scope.selectedServiceIds,
    range: scope.range, day, statuses: filters.statuses,
    summary: buildAgeSummary(rows, dayRows), ticketCount: rows.length, truncated,
  }
}

// ── Ticket detail report ───────────────────────────────────────────────────────────────────────────

interface DetailTicket {
  id: string
  request_no: string
  title: string
  status: string
  priority: string
  created_at: string
  resolved_at: string | null
  closed_at: string | null
  service: { name: string } | null
  category: { name: string } | null
  sub_category: { name: string } | null
  assignee: { full_name: string } | null
  requester: { full_name: string } | null
}

const DETAIL_SELECT = 'id, request_no, title, status, priority, created_at, resolved_at, closed_at, service:services(name), category:service_categories(name), sub_category:service_sub_categories(name), assignee:profiles!requests_assigned_to_fkey(full_name), requester:profiles!requests_requester_id_fkey(full_name)'
/** The most ticket lines one detail report shows or exports (the same cap Report Builder uses). */
export const MAX_DETAIL_ROWS = 20_000

async function fetchDetailRows(
  orgId: string, teamId: string, range: ResolvedRange, statuses: RequestStatus[], serviceIds: string[] | null
): Promise<{ rows: DetailRow[]; truncated: boolean }> {
  const admin = createAdminClient() as unknown as AnyClient
  const now = new Date().toISOString()
  const { rows, truncated } = await fetchAll<DetailTicket>((from, to) => {
    let q = admin.from('requests').select(DETAIL_SELECT).eq('org_id', orgId).eq('team_id', teamId).in('status', statuses)
    if (serviceIds) q = q.in('service_id', serviceIds)
    if (range.from) q = q.gte('created_at', range.from.toISOString())
    if (range.to) q = q.lte('created_at', range.to.toISOString())
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  })
  const mapped: DetailRow[] = rows.map((r) => {
    const ageDays = daysBetween(r.created_at, r.resolved_at ?? r.closed_at ?? now)
    return {
      id: r.id,
      ticketNo: r.request_no,
      subject: r.title,
      requester: r.requester?.full_name ?? '',
      technician: r.assignee?.full_name ?? UNASSIGNED,
      category: r.category?.name ?? NO_CATEGORY,
      subCategory: r.sub_category?.name ?? NO_SUB_CATEGORY,
      service: r.service?.name ?? '',
      status: r.status,
      priority: r.priority,
      createdAt: r.created_at,
      ageDays,
      ageBucket: ageBucketLabel(ageDays),
    }
  })
  const capped = mapped.length > MAX_DETAIL_ROWS
  return { rows: capped ? mapped.slice(0, MAX_DETAIL_ROWS) : mapped, truncated: truncated || capped }
}

export interface TicketDetailReportResult {
  def: AnalyticsReportDef
  team: OrgTeam
  groups: OrgTeam[]
  services: GroupService[]
  selectedServiceIds: string[]
  range: ResolvedRange
  statuses: RequestStatus[]
  /** Technician / age-bucket choices (from the tickets before those two filters) and what is selected. */
  technicians: string[]
  buckets: string[]
  technician: string
  bucket: string
  rows: DetailRow[]
  /** Tickets before the technician / age-bucket filters. */
  totalBeforeFilters: number
  truncated: boolean
}

/** Loads the ticket detail report for a viewer, or says why they cannot have it. */
export async function loadTicketDetailReport(
  profile: ProfileWithTeams,
  slug: string,
  filters: { group?: string; services?: string[]; preset?: string; from?: string; to?: string; statuses: RequestStatus[]; technician?: string; bucket?: string }
): Promise<{ error: string } | TicketDetailReportResult> {
  const scope = await resolveScope(profile, slug, 'ticket-detail', filters)
  if ('error' in scope) return scope
  const { rows: all, truncated } = await fetchDetailRows(profile.org_id!, scope.team.id, scope.range, filters.statuses, scope.serviceIds)
  const technicians = technicianOptions(all)
  const buckets = bucketOptions(all)
  // a technician or bucket that is not in this result (e.g. left over from another group) is ignored
  const technician = technicians.includes(filters.technician ?? '') ? filters.technician! : ''
  const bucket = buckets.includes(filters.bucket ?? '') ? filters.bucket! : ''
  return {
    def: scope.def, team: scope.team, groups: scope.groups, services: scope.services,
    selectedServiceIds: scope.selectedServiceIds, range: scope.range, statuses: filters.statuses,
    technicians, buckets, technician, bucket,
    rows: sortDetailRows(filterDetailRows(all, { technician, bucket })),
    totalBeforeFilters: all.length, truncated,
  }
}
