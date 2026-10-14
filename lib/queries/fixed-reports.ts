// Loads one fixed predefined report (see lib/reporting/analytics/fixed-reports.ts): the tickets it counts, limited to the technician groups the viewer may see
// (admins and owners see every group; a manager or technician only their own), narrowed by the viewer's group / service / technician / status choices,
// turned into the Excel-style table.

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/queries/paging'
import { loadAcContext } from '@/lib/queries/store-ac-stats'
import { canUseReportAnalytics, groupDisplayName, selectableGroups } from '@/lib/reporting/analytics/catalog'
import { makeFact, isNsoStore, isServerRoomAc, DEFAULT_RED_FLAG_PERCENT, type TicketFact, type RawTicket, type FactContext } from '@/lib/reporting/analytics/facts'
import { monthOptions, resolveMonth, resolveMonths } from '@/lib/reporting/analytics/weekly'
import { techOf } from '@/lib/reporting/analytics/age-summary'
import { buildFixedReport, findFixedReport, normName, type FixedReportDef } from '@/lib/reporting/analytics/fixed-reports'
import { effectiveFilter, emptyReportFilter, type EffectiveFilter, type FilterCombo, type FilterDefaults, type ReportFilter } from '@/lib/reporting/analytics/report-filter'
import { referenceDay, resolveDateRange } from '@/lib/reporting/analytics/date-ranges'
import type { ReportTable } from '@/lib/reporting/analytics/report-table'
import { STATUS_LABELS } from '@/lib/constants/requests'
import type { ProfileWithTeams } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** Safety cap: the open tickets of the whole company never get near this; it only stops a runaway query. */
const MAX_TICKETS = 50_000

const FACT_SELECT = 'id, request_no, title, status, priority, created_at, resolved_at, closed_at, form_data, service:services(id, name, auto_oem_routing), category:service_categories(name), sub_category:service_sub_categories(name), assignee:profiles!requests_assigned_to_fkey(full_name), requester:profiles!requests_requester_id_fkey(full_name, store:stores(id, code, city, state, cluster, region, priority_list, festival, ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix, open_date, oem:oems(name)))'

const statusLabel = (s: string) => (STATUS_LABELS as Record<string, string>)[s] ?? s

// D-019: an error on any page throws; reaching the cap is reported to the screen (FixedReportResult.truncated) instead of being hidden
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error?: { message: string } | null }>, onTruncated?: () => void): Promise<T[]> {
  const { rows, truncated } = await fetchAllPages<T>(build, { maxRows: MAX_TICKETS })
  if (truncated) onTruncated?.()
  return rows
}

export interface FilterOptionsData {
  /** the report's tickets by group, service, status and technician (every status) */
  combos: FilterCombo[]
  /** the groups and services the viewer may choose from, for the lists' labels */
  groups: { id: string; name: string }[]
  services: { id: string; name: string; groupId: string }[]
  defaults: FilterDefaults
  /** what is in force now (a report's starting point where nothing is chosen) */
  effective: EffectiveFilter
}

/** The month a monthly report (the Weekly Admin Report) is about, and the months to choose from. */
export interface MonthChoice { /** the month chosen, or the months chosen joined by commas ('2026-04,2026-05') */ value: string; name: string; /** the Monthly reports let several months be chosen */ multi?: boolean; options: { value: string; label: string }[] }

export interface FixedReportResult { def: FixedReportDef; table: ReportTable; filters: FilterOptionsData; month?: MonthChoice; /** true when the report stopped at the row cap: the numbers cover only the first rows */ truncated?: boolean }

/** The list of reports: every report is open to anyone who may use the fixed reports at all. */
export function canOpenFixedReports(profile: Pick<ProfileWithTeams, 'role' | 'org_id'>): boolean {
  return !!profile.org_id && canUseReportAnalytics(profile.role)
}

export async function loadFixedReport(profile: ProfileWithTeams, slug: string, filter: ReportFilter = emptyReportFilter()): Promise<{ error: string } | FixedReportResult> {
  const def = findFixedReport(slug)
  if (!def) return { error: 'This report does not exist.' }
  if (!canOpenFixedReports(profile)) return { error: "You don't have access to this report." }
  const orgId = profile.org_id!
  const admin = createAdminClient() as unknown as AnyClient

  // the groups and services the viewer may see
  const { data: teamRows } = await admin.from('teams').select('id, name').eq('org_id', orgId).eq('is_active', true)
  const visible = selectableGroups(profile, (teamRows ?? []) as { id: string; name: string }[])
  const visibleIds = visible.map((t) => t.id)
  const seesAll = profile.role === 'admin' || profile.role === 'platform_owner'
  const { data: svcRows } = await admin.from('services').select('id, name, team_id').eq('org_id', orgId)
  const services = ((svcRows ?? []) as { id: string; name: string; team_id: string }[]).filter((s) => visibleIds.includes(s.team_id))

  // where the report starts when nothing is chosen: its own group and/or services
  // a manager or technician starts on their own groups (admins and owners on every group), a report that is about one group on that group
  const defGroups = def.group ? visible.filter((t) => groupDisplayName(t.name).toLowerCase() === def.group!.toLowerCase()).map((t) => t.id) : seesAll ? [] : visibleIds
  const wanted = new Set((def.services ?? []).map(normName))
  const defServices = def.services ? services.filter((s) => wanted.has(normName(s.name)) && (defGroups.length === 0 || defGroups.includes(s.team_id))).map((s) => s.id) : []
  const defaults: FilterDefaults = { statuses: def.statuses, groups: defGroups, services: defServices }

  // choices that name a group or service the viewer may not see are ignored
  const clean: ReportFilter = { ...filter, groups: filter.groups.filter((g) => visibleIds.includes(g)), services: filter.services.filter((s) => services.some((x) => x.id === s)) }
  const eff = effectiveFilter(clean, defaults)
  const optionsData = (combos: FilterCombo[]): FilterOptionsData => ({
    combos, groups: visible.map((t) => ({ id: t.id, name: t.name })), services: services.map((s) => ({ id: s.id, name: s.name, groupId: s.team_id })), defaults, effective: eff,
  })
  const statuses = eff.statuses as FixedReportDef['statuses']
  // a monthly report is about one month (this month unless another is chosen), and counts tickets whatever their status is now
  const month = def.layout === 'weekly' ? resolveMonth(clean.month?.split(',')[0]) : undefined
  // a monthly report (Monthly Admin Report, Priority Wise Report) shows any months chosen (this month and the 2 before it when none)
  const months = def.layout === 'monthly' ? resolveMonths(clean.month) : undefined
  const allMonths = monthOptions(new Date())
  const withChosen = (chosen: { value: string; name: string }[]) => [...allMonths, ...chosen.filter((c) => !allMonths.some((o) => o.value === c.value)).map((c) => ({ value: c.value, label: c.name }))]
  const monthChoice: MonthChoice | undefined = month
    ? { value: month.value, name: month.name, options: withChosen([month]) }
    : months && { value: months.map((x) => x.value).join(','), name: months.map((x) => x.name).join(', '), multi: true, options: withChosen(months) }
  const result = (table: ReportTable, combos: FilterCombo[]): FixedReportResult => ({ def, table, filters: optionsData(combos), month: monthChoice })
  const empty = () => result(buildFixedReport({ def, facts: [], statusLabel, statuses, month, months }), [])
  // a report that starts on a group or service the viewer cannot see has nothing to start from
  const startsOnGroup = !!def.group && defGroups.length === 0 && clean.groups.length === 0 && !clean.allGroups
  const startsOnService = !!def.services && defServices.length === 0 && clean.services.length === 0 && !clean.allServices && clean.groups.length === 0 && !clean.allGroups
  if (startsOnGroup || startsOnService) return empty()

  // the groups and services to read: the effective choice, within what the viewer may see
  const teamIds: string[] | null = eff.groups.length > 0 ? eff.groups : seesAll ? null : visibleIds
  if (teamIds && teamIds.length === 0) return empty()
  const serviceIds: string[] | null = eff.services.length > 0 ? eff.services : null

  const { acFields, openAcByStore, acServiceIds } = await loadAcContext(admin, orgId)
  // a weekly / monthly report shows AC tickets by AMC brand while every service in force is an AC service, any other tickets by category
  const acView = eff.services.length > 0 && eff.services.every((id) => acServiceIds.includes(id))
  const ctx: FactContext = { asOf: new Date(), acFields, openAcByStore, redFlagPercent: DEFAULT_RED_FLAG_PERCENT }
  const techOk = (f: TicketFact) => eff.techs.length === 0 || eff.techs.includes(techOf(f.technician))
  // (a weekly report counts the ACs of stores, so the Server Room AC is left out, as in the other AC reports)
  const keep = (f: TicketFact) => (!def.acOnly || f.isAcTicket) && (!def.nso || f.storeType === 'NSO') && techOk(f) && ((def.layout !== 'weekly' && def.layout !== 'monthly') || !isServerRoomAc(f.acNo))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any) => { let x = q.eq('org_id', orgId); if (teamIds) x = x.in('team_id', teamIds); if (serviceIds) x = x.in('service_id', serviceIds); return x }

  let truncated = false
  const raw = await fetchAll<RawTicket>((from, to) => {
    let q = scoped(admin.from('requests').select(FACT_SELECT))
    const span = month ? { start: month.start, end: month.end } : months && months.length > 0 ? { start: months[0].start, end: months[months.length - 1].end } : undefined
    if (span) {
      // the tickets created in the month(s) and the ones resolved (or, failing that, closed) in them, whatever their status is now
      const a = span.start.toISOString()
      const b = span.end.toISOString()
      q = q.or(`and(created_at.gte.${a},created_at.lte.${b}),and(resolved_at.gte.${a},resolved_at.lte.${b}),and(resolved_at.is.null,closed_at.gte.${a},closed_at.lte.${b})`)
    } else q = q.in('status', statuses)
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  }, () => { truncated = true })
  const facts = raw.map((r) => makeFact(r, ctx)).filter(keep)

  // a weekly report's store and AC counts per AMC brand come from the Store Master (active stores), whatever the filters are
  // (a Priority Wise Report groups them by the Store Master's priority list instead)
  let amcStores: { brand: string; stores: number; acs: number }[] | undefined
  if ((month || months) && (acView || def.rowBy === 'priority')) {
    const stores = await fetchAll<{ ac_amc_brand: string | null; priority_list: string | null; ac_total: number | null }>((from, to) =>
      admin.from('stores').select('ac_amc_brand, priority_list, ac_total').eq('org_id', orgId).eq('is_active', true).order('id', { ascending: true }).range(from, to))
    const byBrand = new Map<string, { brand: string; stores: number; acs: number }>()
    for (const s of stores) {
      const brand = (def.rowBy === 'priority' ? s.priority_list : s.ac_amc_brand)?.trim()
      if (!brand) continue
      const k = normName(brand)
      const b = byBrand.get(k) ?? { brand, stores: 0, acs: 0 }
      b.stores++
      b.acs += s.ac_total ?? 0
      byBrand.set(k, b)
    }
    amcStores = [...byBrand.values()]
  }

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

  // the report's kind of tickets by group, service, status and technician (every group the viewer may see, every status): the filter bar's linked lists
  const combos = new Map<string, FilterCombo>()
  if (!def.acOnly || acServiceIds.length > 0) {
    type Light = { status: string; team_id: string; service_id: string; assignee: { full_name: string | null } | null; requester?: { store: { open_date: string | null } | null } | null }
    const light = await fetchAll<Light>((from, to) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = admin.from('requests').select(`status, team_id, service_id, assignee:profiles!requests_assigned_to_fkey(full_name)${def.nso ? ', requester:profiles!requests_requester_id_fkey(store:stores(open_date))' : ''}`).eq('org_id', orgId)
      if (!seesAll) q = q.in('team_id', visibleIds)
      if (def.acOnly) q = q.in('service_id', acServiceIds)
      return q.order('id', { ascending: true }).range(from, to)
    })
    const now = new Date()
    for (const r of light) {
      const st = r.requester?.store
      if (def.nso && !(st && isNsoStore(st.open_date, now))) continue
      const tech = techOf(r.assignee?.full_name)
      const k = `${r.team_id}|${r.service_id}|${r.status}|${tech}`
      const c = combos.get(k)
      if (c) c.count++
      else combos.set(k, { group: r.team_id, service: r.service_id, status: r.status, tech, count: 1 })
    }
  }
  return { ...result(buildFixedReport({ def, facts, dayFacts, day, statusLabel, statuses, month, months, amcStores, acView }), [...combos.values()]), truncated }
}
