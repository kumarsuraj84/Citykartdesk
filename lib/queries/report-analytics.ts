import { createAdminClient } from '@/lib/supabase/admin'
import { buildAgeSummary, type AgeSummary, type SummaryInputRow, type DayInputRow } from '@/lib/reporting/analytics/age-summary'
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
async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<{ rows: TicketRow[]; truncated: boolean }> {
  const rows: TicketRow[] = []
  let truncated = false
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await build(offset, offset + PAGE - 1)
    const page = (data ?? []) as TicketRow[]
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

/** Loads one predefined report for a viewer, or says why they cannot have it. */
export async function loadAgeBucketReport(
  profile: ProfileWithTeams,
  slug: string,
  filters: { group?: string; services?: string[]; preset?: string; from?: string; to?: string; statuses: RequestStatus[] }
): Promise<{ error: string } | AgeBucketReportResult> {
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!canUseReportAnalytics(profile.role)) return { error: "You don't have access to this report." }
  const def = findAnalyticsReport(slug)
  if (!def) return { error: 'This report does not exist.' }

  const groups = selectableGroups(profile, await getOrgTeams(profile.org_id))
  const team = pickGroup(groups, filters.group)
  if (!team) return { error: "You don't belong to a technician group yet, so there is no group to report on." }

  // Only services that really belong to this group count (a service picked for another group is ignored);
  // choosing none, or all of them, means "every service" — no filter, so tickets without a service still show.
  const services = await getGroupServices(profile.org_id, team.id)
  const wanted = new Set(filters.services ?? [])
  const chosen = services.filter((s) => wanted.has(s.id))
  const useFilter = chosen.length > 0 && chosen.length < services.length
  const serviceIds = useFilter ? chosen.map((s) => s.id) : null

  const range = resolveDateRange(filters.preset, filters.from, filters.to)
  const day = referenceDay(range)
  const [{ rows, truncated }, dayRows] = await Promise.all([
    fetchGroupTickets(profile.org_id, team.id, range, filters.statuses, serviceIds),
    fetchDayActivity(profile.org_id, team.id, day, serviceIds),
  ])
  return {
    def, team, groups, services,
    selectedServiceIds: useFilter ? chosen.map((s) => s.id) : services.map((s) => s.id),
    range, day, statuses: filters.statuses,
    summary: buildAgeSummary(rows, dayRows), ticketCount: rows.length, truncated,
  }
}
