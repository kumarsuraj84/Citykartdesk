'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadAgeBucketReport } from '@/lib/queries/report-analytics'
import { parseStatuses, reportTitleForGroup } from '@/lib/reporting/analytics/catalog'
import { buildAgeBucketWorkbook } from '@/lib/reporting/analytics/age-summary-xlsx'
import { STATUS_LABELS } from '@/lib/constants/requests'

/** Excel file for a predefined age-bucket report, built from exactly what the viewer is allowed to see on screen. */
export async function exportAgeBucketReportXlsx(
  slug: string,
  filters: {
    group?: string; service?: string[]; preset?: string; from?: string; to?: string; status?: string[]
    /** Technicians / categories the viewer collapsed on screen (see lib/reporting/analytics/summary-rows.ts). */
    collapsedTech?: string[]; collapsedCat?: string[]
  }
): Promise<{ data?: string; filename?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const res = await loadAgeBucketReport(profile, slug, {
    group: filters.group, services: filters.service, preset: filters.preset, from: filters.from, to: filters.to, statuses: parseStatuses(filters.status),
  })
  if ('error' in res) return { error: res.error }

  const title = reportTitleForGroup(res.def, res.team.name)
  const workbook = buildAgeBucketWorkbook({
    title,
    teamName: res.team.name,
    rangeLabel: res.range.label,
    statusLabels: res.statuses.map((s) => STATUS_LABELS[s]),
    servicesLabel: res.selectedServiceIds.length >= res.services.length
      ? 'All services'
      : res.services.filter((s) => res.selectedServiceIds.includes(s.id)).map((s) => s.name).join(', '),
    dayWord: res.day.word,
    ticketCount: res.ticketCount,
    summary: res.summary,
    collapsed: { tech: new Set(filters.collapsedTech ?? []), cat: new Set(filters.collapsedCat ?? []) },
  })
  const buffer = await workbook.xlsx.writeBuffer()
  const stamp = new Date().toISOString().slice(0, 10)
  return { data: Buffer.from(buffer).toString('base64'), filename: `${title} - ${stamp}.xlsx` }
}
