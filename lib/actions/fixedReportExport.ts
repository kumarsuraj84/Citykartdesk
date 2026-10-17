'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadFixedReport } from '@/lib/queries/fixed-reports'
import { buildReportWorkbook } from '@/lib/reporting/analytics/report-table-xlsx'
import { parseReportFilter } from '@/lib/reporting/analytics/report-filter'
import { exportAllowed, auditExportEvent, EXPORT_LIMIT_MESSAGE } from '@/lib/security/export-guard'

type Result = { data?: string; filename?: string; error?: string }

/** The Excel file of a fixed report: exactly the table the viewer is allowed to see on screen, with the status and technician choices made on it. */
export async function exportFixedReportXlsx(slug: string, choice: { status?: string; tech?: string; group?: string; service?: string; month?: string } = {}): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!(await exportAllowed(profile.id, 'fixed_report'))) return { error: EXPORT_LIMIT_MESSAGE }
  const res = await loadFixedReport(profile, slug, parseReportFilter(choice))
  if ('error' in res) return { error: res.error }
  await auditExportEvent(profile, 'fixed_report', res.table.rows.length, { slug, ...choice })
  const buffer = (await buildReportWorkbook(res.table).xlsx.writeBuffer()) as ArrayBuffer
  const name = res.def.title.replace(/[^\x20-\x7E]/g, '').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Report'
  return { data: Buffer.from(buffer).toString('base64'), filename: `${name} - ${new Date().toISOString().slice(0, 10)}.xlsx` }
}
