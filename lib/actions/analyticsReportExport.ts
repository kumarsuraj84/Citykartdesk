'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadAgeBucketReport, loadTicketDetailReport, loadTicketTreeReport, loadStoreAcReport, type LoadParams, type ReportBase } from '@/lib/queries/report-analytics'
import { parseStatuses, reportTitleForGroup } from '@/lib/reporting/analytics/catalog'
import { facetDef, isFacetKey, type FacetKey, type FacetSelection } from '@/lib/reporting/analytics/facets'
import { buildAgeBucketWorkbook } from '@/lib/reporting/analytics/age-summary-xlsx'
import { buildTicketDetailWorkbook } from '@/lib/reporting/analytics/ticket-detail-xlsx'
import { buildTicketTreeWorkbook } from '@/lib/reporting/analytics/ticket-tree-xlsx'
import { buildStoreAcWorkbook } from '@/lib/reporting/analytics/store-ac-xlsx'
import { columnsFor } from '@/lib/reporting/analytics/ticket-tree'
import { STATUS_LABELS } from '@/lib/constants/requests'

type Result = { data?: string; filename?: string; error?: string }

/** What every report export is asked for: the group, services, dates, statuses and the filter bar's choices (f_<name> -> value). */
interface CommonFilters {
  group?: string; service?: string[]; preset?: string; from?: string; to?: string; status?: string[]
  filters?: Record<string, string>
  redFlagPercent?: string
}

function selectionOf(filters: Record<string, string> | undefined): FacetSelection {
  const sel: FacetSelection = {}
  for (const [k, v] of Object.entries(filters ?? {})) {
    const key = k.startsWith('f_') ? k.slice(2) : k
    if (v && isFacetKey(key)) sel[key as FacetKey] = v
  }
  return sel
}

function paramsOf(f: CommonFilters): LoadParams {
  const rf = Number(f.redFlagPercent)
  return {
    group: f.group, services: f.service, preset: f.preset, from: f.from, to: f.to, statuses: parseStatuses(f.status),
    facets: selectionOf(f.filters), redFlagPercent: Number.isFinite(rf) && rf > 0 ? rf : undefined,
  }
}

const servicesLabel = (r: ReportBase) =>
  r.selectedServiceIds.length >= r.services.length ? 'All services' : r.services.filter((s) => r.selectedServiceIds.includes(s.id)).map((s) => s.name).join(', ')

/** The chosen filters in words, as shown in the Excel file's header. */
const filtersText = (r: ReportBase, extra: string[] = []) =>
  [...(Object.entries(r.facets.selection) as [FacetKey, string][]).map(([k, v]) => `${facetDef(k).label}: ${v}`), ...extra].join(' · ')

const stamp = () => new Date().toISOString().slice(0, 10)
const file = async (title: string, wb: { xlsx: { writeBuffer: () => Promise<unknown> } }): Promise<Result> => {
  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer
  return { data: Buffer.from(buffer).toString('base64'), filename: `${title} - ${stamp()}.xlsx` }
}
const statusLabel = (s: string) => (STATUS_LABELS as Record<string, string>)[s] ?? s

/** Excel file for a predefined age-bucket report, built from exactly what the viewer is allowed to see on screen. */
export async function exportAgeBucketReportXlsx(
  slug: string,
  filters: CommonFilters & {
    /** Technicians / categories the viewer collapsed on screen (see lib/reporting/analytics/summary-rows.ts). */
    collapsedTech?: string[]; collapsedCat?: string[]
  }
): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const res = await loadAgeBucketReport(profile, slug, paramsOf(filters))
  if ('error' in res) return { error: res.error }

  const title = reportTitleForGroup(res.def, res.team.name)
  return file(title, buildAgeBucketWorkbook({
    title,
    teamName: res.team.name,
    rangeLabel: res.range.label,
    statusLabels: res.statuses.map((s) => STATUS_LABELS[s]),
    servicesLabel: servicesLabel(res),
    dayWord: res.day.word,
    ticketCount: res.ticketCount,
    filtersText: filtersText(res),
    summary: res.summary,
    collapsed: { tech: new Set(filters.collapsedTech ?? []), cat: new Set(filters.collapsedCat ?? []) },
  }))
}

/** Excel file for the ticket detail report: one line per ticket, the same lines the viewer sees on screen. */
export async function exportTicketDetailReportXlsx(slug: string, filters: CommonFilters): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const res = await loadTicketDetailReport(profile, slug, paramsOf(filters))
  if ('error' in res) return { error: res.error }

  const title = reportTitleForGroup(res.def, res.team.name)
  return file(title, buildTicketDetailWorkbook({
    title,
    teamName: res.team.name,
    rangeLabel: res.range.label,
    statusLabels: res.statuses.map((s) => STATUS_LABELS[s]),
    servicesLabel: servicesLabel(res),
    extraFilters: filtersText(res),
    rows: res.rows,
    statusLabel,
  }))
}

/** Excel file for a grouped ticket report (Ticket Status, Store wise, AMC Vendor): the same headings and stores the viewer sees, folded the way they have them folded. */
export async function exportTicketTreeReportXlsx(
  slug: string,
  filters: CommonFilters & { layout?: string; minTickets?: string; collapsed?: string[] }
): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const res = await loadTicketTreeReport(profile, slug, { ...paramsOf(filters), layout: filters.layout, minTickets: filters.minTickets })
  if ('error' in res) return { error: res.error }

  const title = reportTitleForGroup(res.def, res.team.name)
  return file(title, buildTicketTreeWorkbook({
    title,
    teamName: res.team.name,
    rangeLabel: res.range.label,
    statusLabels: res.statuses.map((s) => STATUS_LABELS[s]),
    servicesLabel: servicesLabel(res),
    filtersText: filtersText(res, [`Layout: ${res.layout.label}`, ...(res.minTickets > 1 ? [`Stores with at least ${res.minTickets} tickets`] : [])]),
    tree: res.tree,
    columns: columnsFor(res.def.tree!.columns, res.layout.levels, res.acAvailable),
    collapsed: new Set(filters.collapsed ?? []),
    statusLabel,
  }))
}

/** Excel file for the Store AC Not Working report: the same groups and stores as on screen. */
export async function exportStoreAcReportXlsx(
  slug: string,
  filters: CommonFilters & { groupBy?: string; collapsed?: string[] }
): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const res = await loadStoreAcReport(profile, slug, { ...paramsOf(filters), groupBy: filters.groupBy })
  if ('error' in res) return { error: res.error }

  const title = reportTitleForGroup(res.def, res.team.name)
  return file(title, buildStoreAcWorkbook({
    title,
    teamName: res.team.name,
    rangeLabel: res.range.label,
    statusLabels: res.statuses.map((s) => STATUS_LABELS[s]),
    servicesLabel: servicesLabel(res),
    filtersText: filtersText(res),
    redFlagPercent: res.redFlagPercent,
    groupBy: res.groupBy,
    report: res.report,
    collapsed: new Set(filters.collapsed ?? []),
  }))
}
