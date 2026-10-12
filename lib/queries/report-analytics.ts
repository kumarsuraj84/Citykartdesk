import { createAdminClient } from '@/lib/supabase/admin'
import { loadAcContext } from '@/lib/queries/store-ac-stats'
import { buildAgeSummary, type AgeSummary, type SummaryInputRow, type DayInputRow } from '@/lib/reporting/analytics/age-summary'
import { sortDetailRows } from '@/lib/reporting/analytics/ticket-detail'
import {
  ANALYTICS_REPORTS, findAnalyticsReport, canUseReportAnalytics, selectableGroups, pickGroup, type AnalyticsReportDef,
} from '@/lib/reporting/analytics/catalog'
import {
  makeFact, DEFAULT_RED_FLAG_PERCENT,
  type TicketFact, type RawTicket, type FactContext,
} from '@/lib/reporting/analytics/facts'
import {
  applyFacets, facetOptions, reconcileSelection, type FacetKey, type FacetOption, type FacetSelection,
} from '@/lib/reporting/analytics/facets'
import { buildTicketTree, layoutById, layoutUsesOem, parseMinTickets, type Layout, type TicketTree } from '@/lib/reporting/analytics/ticket-tree'
import { buildStoreAc, parseStoreAcGroup, type StoreAcGroupBy, type StoreAcReport } from '@/lib/reporting/analytics/store-ac'
import { resolveDateRange, referenceDay, type ResolvedRange, type ReferenceDay } from '@/lib/reporting/analytics/date-ranges'
import type { ProfileWithTeams, RequestStatus } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const PAGE = 1000
/** Safety cap — a technician group's tickets never get near this; it only stops a runaway query. */
const MAX_TICKETS = 50_000
/** The most ticket lines one detail report shows or exports (the same cap Report Builder uses). */
export const MAX_DETAIL_ROWS = 20_000

export interface OrgTeam { id: string; name: string }
/** `oemRouted`: tickets of this service go to the store's OEM (AC servicing) — the only tickets an OEM has anything to do with. */
export interface GroupService { id: string; name: string; oemRouted: boolean }

type ServiceRow = { id: string; name: string; auto_oem_routing: boolean | null }
const toService = (s: ServiceRow): GroupService => ({ id: s.id, name: s.name, oemRouted: !!s.auto_oem_routing })

/** The organisation's active technician groups. */
export async function getOrgTeams(orgId: string): Promise<OrgTeam[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin.from('teams').select('id, name').eq('org_id', orgId).eq('is_active', true)
  return (data ?? []) as OrgTeam[]
}

/** The services that belong to a technician group (one group can run several). */
export async function getGroupServices(orgId: string, teamId: string): Promise<GroupService[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin.from('services').select('id, name, auto_oem_routing').eq('org_id', orgId).eq('team_id', teamId).order('name', { ascending: true })
  return ((data ?? []) as ServiceRow[]).map(toService)
}

/** The predefined reports a viewer can open (none when they belong to no technician group and are not an admin/owner). */
export async function listReportsForViewer(profile: ProfileWithTeams): Promise<AnalyticsReportDef[]> {
  if (!profile.org_id || !canUseReportAnalytics(profile.role)) return []
  const groups = selectableGroups(profile, await getOrgTeams(profile.org_id))
  return groups.length > 0 ? ANALYTICS_REPORTS : []
}

/** Pages through a query until it runs out (PostgREST returns at most 1000 rows per request). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<{ rows: T[]; truncated: boolean }> {
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

// ── Reading the tickets as facts ─────────────────────────────────────────────────────────────────

const FACT_SELECT = 'id, request_no, title, status, priority, created_at, resolved_at, closed_at, form_data, service:services(id, name, auto_oem_routing), category:service_categories(name), sub_category:service_sub_categories(name), assignee:profiles!requests_assigned_to_fkey(full_name), requester:profiles!requests_requester_id_fkey(full_name, store:stores(id, code, city, state, cluster, region, priority_list, festival, ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix, open_date, oem:oems(name)))'

/** What is needed besides the tickets themselves: where the AC form fields of each service are, and each store's open AC tickets (see store-ac-stats.ts). */
async function loadFactContext(orgId: string, redFlagPercent: number): Promise<{ ctx: FactContext; acServiceIds: string[] }> {
  const admin = createAdminClient() as unknown as AnyClient
  const { acFields, openAcByStore, acServiceIds } = await loadAcContext(admin, orgId)
  return { ctx: { asOf: new Date(), acFields, openAcByStore, redFlagPercent }, acServiceIds }
}

export interface ReportScope {
  def: AnalyticsReportDef
  team: OrgTeam
  groups: OrgTeam[]
  services: GroupService[]
  selectedServiceIds: string[]
  /** null = every service (no filter) */
  serviceIds: string[] | null
  /** some chosen service goes to an OEM (AC servicing) */
  acAvailable: boolean
  range: ResolvedRange
}

export interface LoadParams {
  group?: string
  services?: string[]
  preset?: string
  from?: string
  to?: string
  statuses: RequestStatus[]
  /** the filters chosen in the filter bar (each is dropped when it no longer fits the others) */
  facets?: FacetSelection
  /** AC Not Working % above this is a red flag */
  redFlagPercent?: number
}

/** Who may open which report, which group it is about, which services and dates are included — shared by every report. */
async function resolveScope(profile: ProfileWithTeams, slug: string, kinds: AnalyticsReportDef['kind'][], p: LoadParams): Promise<{ error: string } | ReportScope> {
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!canUseReportAnalytics(profile.role)) return { error: "You don't have access to this report." }
  const def = findAnalyticsReport(slug)
  if (!def || !kinds.includes(def.kind)) return { error: 'This report does not exist.' }

  const groups = selectableGroups(profile, await getOrgTeams(profile.org_id))
  const team = pickGroup(groups, p.group)
  if (!team) return { error: "You don't belong to a technician group yet, so there is no group to report on." }

  // Only services that really belong to this group count (a service picked for another group is ignored);
  // choosing none, or all of them, means "every service" — no filter, so tickets without a service still show.
  // An AC report starts from the group's AC services.
  const services = await getGroupServices(profile.org_id, team.id)
  const wanted = new Set(p.services ?? [])
  const chosen = services.filter((s) => wanted.has(s.id))
  const useFilter = chosen.length > 0 && chosen.length < services.length
  const acIds = services.filter((s) => s.oemRouted).map((s) => s.id)
  let selectedServiceIds: string[]
  let serviceIds: string[] | null
  if (useFilter) { selectedServiceIds = chosen.map((s) => s.id); serviceIds = selectedServiceIds }
  else if (def.acOnly) { selectedServiceIds = acIds; serviceIds = acIds }
  else { selectedServiceIds = services.map((s) => s.id); serviceIds = null }
  const acAvailable = services.some((s) => selectedServiceIds.includes(s.id) && s.oemRouted)
  return { def, team, groups, services, selectedServiceIds, serviceIds, acAvailable, range: resolveDateRange(p.preset, p.from, p.to) }
}

function inServices(q: AnyClient & { in: (c: string, v: string[]) => unknown }, serviceIds: string[] | null) {
  return serviceIds ? q.in('service_id', serviceIds) : q
}

/** Every ticket of the group created in the range, in the given statuses (and services), as facts. */
async function fetchFacts(orgId: string, teamId: string, scope: ReportScope, statuses: RequestStatus[], ctx: FactContext): Promise<{ rows: TicketFact[]; truncated: boolean }> {
  if (scope.serviceIds && scope.serviceIds.length === 0) return { rows: [], truncated: false }
  const admin = createAdminClient() as unknown as AnyClient
  const { rows, truncated } = await fetchAll<RawTicket>((from, to) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = admin.from('requests').select(FACT_SELECT).eq('org_id', orgId).eq('team_id', teamId).in('status', statuses)
    q = inServices(q, scope.serviceIds)
    if (scope.range.from) q = q.gte('created_at', scope.range.from.toISOString())
    if (scope.range.to) q = q.lte('created_at', scope.range.to.toISOString())
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  })
  return { rows: rows.map((r) => makeFact(r, ctx)), truncated }
}

/** Tickets of the group that were created or resolved on the reference day — whatever their status now. */
async function fetchDayFacts(orgId: string, teamId: string, scope: ReportScope, day: ReferenceDay, ctx: FactContext): Promise<TicketFact[]> {
  if (scope.serviceIds && scope.serviceIds.length === 0) return []
  const admin = createAdminClient() as unknown as AnyClient
  const a = day.start.toISOString()
  const b = day.end.toISOString()
  const { rows } = await fetchAll<RawTicket>((from, to) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = admin.from('requests').select(FACT_SELECT).eq('org_id', orgId).eq('team_id', teamId)
      .or(`and(created_at.gte.${a},created_at.lte.${b}),and(resolved_at.gte.${a},resolved_at.lte.${b})`)
    q = inServices(q, scope.serviceIds)
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  })
  return rows.map((r) => makeFact(r, ctx))
}

// ── Common result ────────────────────────────────────────────────────────────────────────────────

export interface FacetState {
  /** the filters this report offers, in order */
  keys: FacetKey[]
  /** what is chosen (only values that fit the other choices) */
  selection: FacetSelection
  /** each filter's choices, given the other filters */
  options: Record<FacetKey, FacetOption[]>
}

export interface ReportBase {
  def: AnalyticsReportDef
  team: OrgTeam
  groups: OrgTeam[]
  services: GroupService[]
  selectedServiceIds: string[]
  acAvailable: boolean
  range: ResolvedRange
  statuses: RequestStatus[]
  facets: FacetState
  /** tickets before the filter bar's filters */
  totalBeforeFilters: number
  truncated: boolean
  redFlagPercent: number
}

interface Prepared {
  scope: ReportScope
  ctx: FactContext
  all: TicketFact[]
  /** tickets that match the filter bar */
  filtered: TicketFact[]
  base: ReportBase
}

async function prepare(profile: ProfileWithTeams, slug: string, kinds: AnalyticsReportDef['kind'][], p: LoadParams): Promise<{ error: string } | Prepared> {
  const scope = await resolveScope(profile, slug, kinds, p)
  if ('error' in scope) return scope
  const redFlagPercent = p.redFlagPercent && p.redFlagPercent > 0 ? p.redFlagPercent : DEFAULT_RED_FLAG_PERCENT
  const { ctx } = await loadFactContext(profile.org_id!, redFlagPercent)
  const { rows: fetched, truncated } = await fetchFacts(profile.org_id!, scope.team.id, scope, p.statuses, ctx)
  // an AC report is about AC tickets only
  const all = scope.def.acOnly ? fetched.filter((t) => t.isAcTicket) : fetched

  const keys = [...scope.def.facets, ...(scope.acAvailable ? (scope.def.acFacets ?? []) : [])]
  const selection = reconcileSelection(all, p.facets ?? {}, keys)
  const filtered = applyFacets(all, selection)
  return {
    scope, ctx, all, filtered,
    base: {
      def: scope.def, team: scope.team, groups: scope.groups, services: scope.services, selectedServiceIds: scope.selectedServiceIds,
      acAvailable: scope.acAvailable, range: scope.range, statuses: p.statuses,
      facets: { keys, selection, options: facetOptions(all, selection, keys) },
      totalBeforeFilters: all.length, truncated, redFlagPercent,
    },
  }
}

// ── Tickets summary ──────────────────────────────────────────────────────────────────────────────

export interface AgeBucketReportResult extends ReportBase {
  /** The day the "created / resolved that day" columns are about. */
  day: ReferenceDay
  summary: AgeSummary
  ticketCount: number
}

/** Loads the summary report for a viewer, or says why they cannot have it. */
export async function loadAgeBucketReport(profile: ProfileWithTeams, slug: string, p: LoadParams): Promise<{ error: string } | AgeBucketReportResult> {
  const prep = await prepare(profile, slug, ['age-summary'], p)
  if ('error' in prep) return prep
  const day = referenceDay(prep.scope.range)
  // the "that day" columns follow the same filters, whatever the status filter says; a cancelled ticket was never work, so it is not counted
  const dayAll = await fetchDayFacts(profile.org_id!, prep.scope.team.id, prep.scope, day, prep.ctx)
  const dayFiltered = applyFacets(dayAll.filter((t) => t.status !== 'cancelled'), prep.base.facets.selection)
  const a = day.start.toISOString()
  const b = day.end.toISOString()
  const within = (iso: string | null) => !!iso && iso >= a && iso <= b

  const rows: SummaryInputRow[] = prep.filtered.map((t) => ({ technician: t.technician, category: t.category, subCategory: t.subCategory, ageDays: t.ageDays }))
  const dayRows: DayInputRow[] = dayFiltered.map((t) => ({
    technician: t.technician, category: t.category, subCategory: t.subCategory, created: within(t.createdAt), resolved: within(t.resolvedAt),
  }))
  return { ...prep.base, day, summary: buildAgeSummary(rows, dayRows), ticketCount: rows.length }
}

// ── Ticket detail ────────────────────────────────────────────────────────────────────────────────

export interface TicketDetailReportResult extends ReportBase {
  rows: TicketFact[]
}

/** Loads the ticket detail report for a viewer, or says why they cannot have it. */
export async function loadTicketDetailReport(profile: ProfileWithTeams, slug: string, p: LoadParams): Promise<{ error: string } | TicketDetailReportResult> {
  const prep = await prepare(profile, slug, ['ticket-detail'], p)
  if ('error' in prep) return prep
  const sorted = sortDetailRows(prep.filtered)
  const capped = sorted.length > MAX_DETAIL_ROWS
  return { ...prep.base, rows: capped ? sorted.slice(0, MAX_DETAIL_ROWS) : sorted, truncated: prep.base.truncated || capped }
}

// ── Grouped ticket reports (Ticket Status, Store wise, AMC Vendor) ───────────────────────────────

export interface TicketTreeReportResult extends ReportBase {
  layout: Layout
  tree: TicketTree
  minTickets: number
}

export async function loadTicketTreeReport(
  profile: ProfileWithTeams,
  slug: string,
  p: LoadParams & { layout?: string; minTickets?: string }
): Promise<{ error: string } | TicketTreeReportResult> {
  const prep = await prepare(profile, slug, ['ticket-tree'], p)
  if ('error' in prep) return prep
  const cfg = prep.scope.def.tree!
  let layout = layoutById(cfg.layouts.includes(p.layout ?? '') ? p.layout : undefined, cfg.defaultLayout)
  // no chosen service goes to an OEM: grouping by OEM would be empty, so the report opens with its usual layout
  if (layoutUsesOem(layout) && !prep.scope.acAvailable) layout = layoutById(undefined, cfg.defaultLayout)
  const minTickets = cfg.minTicketsFilter ? parseMinTickets(p.minTickets) : 1
  return { ...prep.base, layout, minTickets, tree: buildTicketTree(prep.filtered, layout.levels, minTickets) }
}

// ── Store AC Not Working ─────────────────────────────────────────────────────────────────────────

export interface StoreAcReportResult extends ReportBase {
  groupBy: StoreAcGroupBy
  report: StoreAcReport
}

export async function loadStoreAcReport(
  profile: ProfileWithTeams,
  slug: string,
  p: LoadParams & { groupBy?: string }
): Promise<{ error: string } | StoreAcReportResult> {
  const prep = await prepare(profile, slug, ['store-ac'], p)
  if ('error' in prep) return prep
  const groupBy = parseStoreAcGroup(p.groupBy)
  return { ...prep.base, groupBy, report: buildStoreAc(prep.filtered, groupBy, prep.base.redFlagPercent) }
}
