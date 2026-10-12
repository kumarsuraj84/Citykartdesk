// Loads one fixed predefined report (see lib/reporting/analytics/fixed-reports.ts): the tickets it counts, limited to the technician groups the viewer may see
// (admins and owners see every group; a manager or technician only their own), turned into the Excel-style table.

import { createAdminClient } from '@/lib/supabase/admin'
import { loadAcContext } from '@/lib/queries/store-ac-stats'
import { canUseReportAnalytics, selectableGroups } from '@/lib/reporting/analytics/catalog'
import { makeFact, isNsoStore, DEFAULT_RED_FLAG_PERCENT, type TicketFact, type RawTicket, type FactContext } from '@/lib/reporting/analytics/facts'
import { techOf } from '@/lib/reporting/analytics/age-summary'
import { emptyReportFilter, type FilterCombo, type ReportFilter } from '@/lib/reporting/analytics/report-filter'
import { buildFixedReport, findFixedReport, normName, type FixedReportDef } from '@/lib/reporting/analytics/fixed-reports'
import { groupDisplayName } from '@/lib/reporting/analytics/catalog'
import { referenceDay, resolveDateRange } from '@/lib/reporting/analytics/date-ranges'
import type { ReportTable } from '@/lib/reporting/analytics/report-table'
import { STATUS_LABELS } from '@/lib/constants/requests'
import type { ProfileWithTeams } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const PAGE = 1000
/** Safety cap: the open tickets of the whole company never get near this; it only stops a runaway query. */
const MAX_TICKETS = 50_000

const FACT_SELECT = 'id, request_no, title, status, priority, created_at, resolved_at, closed_at, form_data, service:services(id, name, auto_oem_routing), category:service_categories(name), sub_category:service_sub_categories(name), assignee:profiles!requests_assigned_to_fkey(full_name), requester:profiles!requests_requester_id_fkey(full_name, store:stores(id, code, city, state, cluster, region, priority_list, festival, ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix, open_date, oem:oems(name)))'

const statusLabel = (s: string) => (STATUS_LABELS as Record<string, string>)[s] ?? s

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < MAX_TICKETS; offset += PAGE) {
    const { data } = await build(offset, offset + PAGE - 1)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

export interface FixedReportResult {
  def: FixedReportDef
  table: ReportTable
  /** what the filter bar needs: the report's tickets by status and technician, its own statuses, and what is chosen */
  filters: { combos: FilterCombo[]; defaultStatuses: string[]; selected: ReportFilter }
}

/** The list of reports: every report is open to anyone who may use Report Analytics at all. */
export function canOpenFixedReports(profile: Pick<ProfileWithTeams, 'role' | 'org_id'>): boolean {
  return !!profile.org_id && canUseReportAnalytics(profile.role)
}

export async function loadFixedReport(profile: ProfileWithTeams, slug: string, filter: ReportFilter = emptyReportFilter()): Promise<{ error: string } | FixedReportResult> {
  const def = findFixedReport(slug)
  if (!def) return { error: 'This report does not exist.' }
  if (!canOpenFixedReports(profile)) return { error: "You don't have access to this report." }
  const orgId = profile.org_id!
  const admin = createAdminClient() as unknown as AnyClient

  // the technician groups this report is about, among the ones the viewer may see
  const { data: teamRows } = await admin.from('teams').select('id, name').eq('org_id', orgId).eq('is_active', true)
  const teams = (teamRows ?? []) as { id: string; name: string }[]
  const seesAll = profile.role === 'admin' || profile.role === 'platform_owner'
  let teamIds: string[] | null = null // null = every group (no filter)
  if (def.group || !seesAll) {
    const visible = selectableGroups(profile, teams).filter((t) => !def.group || groupDisplayName(t.name).toLowerCase() === def.group.toLowerCase())
    teamIds = visible.map((t) => t.id)
  }
  const statuses = filter.statuses.length > 0 ? (filter.statuses as FixedReportDef['statuses']) : def.statuses
  const result = (table: ReportTable, combos: FilterCombo[]): FixedReportResult => ({ def, table, filters: { combos, defaultStatuses: def.statuses, selected: { statuses, techs: filter.techs } } })
  const empty = () => result(buildFixedReport({ def, facts: [], statusLabel, statuses }), [])
  if (teamIds && teamIds.length === 0) return empty()

  // services by name
  let serviceIds: string[] | null = null
  if (def.services) {
    const wanted = new Set(def.services.map(normName))
    const { data: svc } = await admin.from('services').select('id, name, team_id').eq('org_id', orgId)
    serviceIds = ((svc ?? []) as { id: string; name: string; team_id: string }[])
      .filter((s) => wanted.has(normName(s.name)) && (!teamIds || teamIds.includes(s.team_id))).map((s) => s.id)
    if (serviceIds.length === 0) return empty()
  }

  const { acFields, openAcByStore, acServiceIds } = await loadAcContext(admin, orgId)
  const ctx: FactContext = { asOf: new Date(), acFields, openAcByStore, redFlagPercent: DEFAULT_RED_FLAG_PERCENT }
  const techOk = (f: TicketFact) => filter.techs.length === 0 || filter.techs.includes(techOf(f.technician))
  const keep = (f: TicketFact) => (!def.acOnly || f.isAcTicket) && (!def.nso || f.storeType === 'NSO') && techOk(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any) => { let x = q.eq('org_id', orgId); if (teamIds) x = x.in('team_id', teamIds); if (serviceIds) x = x.in('service_id', serviceIds); return x }

  const raw = await fetchAll<RawTicket>((from, to) =>
    scoped(admin.from('requests').select(FACT_SELECT)).in('status', statuses).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to))
  const facts = raw.map((r) => makeFact(r, ctx)).filter(keep)

  // a summary also shows what was created and resolved today, whatever the status is now
  let dayFacts: TicketFact[] | undefined
  let day: { start: Date; end: Date; word: string } | undefined
  if (def.layout === 'summary') {
    const ref = referenceDay(resolveDateRange(undefined))
    day = { start: ref.start, end: ref.end, word: ref.word }
    const a = ref.start.toISOString()
    const b = ref.end.toISOString()
    const dayRaw = await fetchAll<RawTicket>((from, to) =>
      scoped(admin.from('requests').select(FACT_SELECT)).or(`and(created_at.gte.${a},created_at.lte.${b}),and(resolved_at.gte.${a},resolved_at.lte.${b})`)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to))
    dayFacts = dayRaw.map((r) => makeFact(r, ctx)).filter(keep)
  }

  // the report's tickets by status and technician (every status), for the filter bar's linked lists
  const combos = new Map<string, FilterCombo>()
  if (!def.acOnly || acServiceIds.length > 0) {
    const light = await fetchAll<{ status: string; assignee: { full_name: string | null } | null; requester?: { store: { open_date: string | null } | null } | null }>((from, to) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = scoped(admin.from('requests').select(`status, assignee:profiles!requests_assigned_to_fkey(full_name)${def.nso ? ', requester:profiles!requests_requester_id_fkey(store:stores(open_date))' : ''}`))
      if (def.acOnly) q = q.in('service_id', acServiceIds)
      return q.order('id', { ascending: true }).range(from, to)
    })
    const now = new Date()
    for (const r of light) {
      const st = r.requester?.store
      if (def.nso && !(st && isNsoStore(st.open_date, now))) continue
      const tech = techOf(r.assignee?.full_name)
      const k = `${r.status}|${tech}`
      const c = combos.get(k)
      if (c) c.count++
      else combos.set(k, { status: r.status, tech, count: 1 })
    }
  }
  return result(buildFixedReport({ def, facts, dayFacts, day, statusLabel, statuses }), [...combos.values()])
}
