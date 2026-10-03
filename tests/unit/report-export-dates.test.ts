/**
 * The Report Builder's Excel export wrote the raw timestamp
 * ("2026-09-30T15:39:17.016734+05:30") into date columns, while the on-screen
 * table showed only the date. Both must show the date only; the time of day
 * lives in the companion "<Label> Time" column.
 */
import { describe, it, expect, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { getEntityFields } from '@/lib/reporting/field-registry'

const { fetchReportDataMock, getFieldsMock, authMock } = vi.hoisted(() => ({
  fetchReportDataMock: vi.fn(),
  getFieldsMock: vi.fn(),
  authMock: vi.fn(),
}))
vi.mock('@/lib/queries/reporting', () => ({
  fetchReportData: fetchReportDataMock,
  getReportFieldsForEntity: getFieldsMock,
}))
vi.mock('@/lib/reporting/access', () => ({ authorizeReportAccess: authMock }))

import { exportReportXlsx } from '@/lib/actions/reportExport'

describe('exportReportXlsx — date columns', () => {
  it('writes date-only text for a timestamp field, not the raw ISO timestamp', async () => {
    authMock.mockResolvedValue({ profile: { org_id: 'org-1' }, scope: { kind: 'all' } })
    getFieldsMock.mockResolvedValue(getEntityFields('requests', []))
    fetchReportDataMock.mockResolvedValue({
      rows: [{ request_no: 'CKSD-000001', created_at: '2026-09-30T15:39:17.016734+05:30', created_at_time: '15:39' }],
      truncated: false,
    })

    const res = await exportReportXlsx('requests', {
      mode: 'table',
      columns: ['request_no', 'created_at', 'created_at_time'],
      pivot: { rowFields: [], colFields: [], valueFields: [], filters: [] },
    })
    expect(res.error).toBeUndefined()

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(res.data!, 'base64') as never)
    const sheet = wb.getWorksheet('Data')!
    expect(sheet.getRow(2).getCell(2).value).toBe('2026-09-30')
    expect(sheet.getRow(2).getCell(3).value).toBe('15:39')
  })

  it('trims every date column on the Requests report, keeping each companion time column', async () => {
    const dateKeys = getEntityFields('requests', []).filter((f) => f.type === 'date').map((f) => f.key)
    expect(dateKeys).toEqual(expect.arrayContaining([
      'created_at', 'updated_at', 'responded_at', 'resolved_at', 'closed_at',
      'resolution_due_at', 'response_due_at', 'approval_decided_at',
    ]))

    const row: Record<string, string> = {}
    for (const k of dateKeys) { row[k] = '2026-10-02T18:33:30.508043+05:30'; row[`${k}_time`] = '18:33' }
    authMock.mockResolvedValue({ profile: { org_id: 'org-1' }, scope: { kind: 'all' } })
    getFieldsMock.mockResolvedValue(getEntityFields('requests', []))
    fetchReportDataMock.mockResolvedValue({ rows: [row], truncated: false })

    const res = await exportReportXlsx('requests', {
      mode: 'table',
      columns: dateKeys,
      pivot: { rowFields: [], colFields: [], valueFields: [], filters: [] },
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(res.data!, 'base64') as never)
    const sheet = wb.getWorksheet('Data')!
    dateKeys.forEach((_, i) => expect(sheet.getRow(2).getCell(i + 1).value).toBe('2026-10-02'))
  })
})
