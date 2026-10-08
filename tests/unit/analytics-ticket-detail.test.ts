import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { sortDetailRows, filterDetailRows, technicianOptions, bucketOptions, type DetailRow } from '@/lib/reporting/analytics/ticket-detail'
import { buildTicketDetailWorkbook, DETAIL_COLUMNS, DETAIL_HEADER_ROW, detailBuckets, bucketTotals } from '@/lib/reporting/analytics/ticket-detail-xlsx'

const row = (o: Partial<DetailRow>): DetailRow => ({
  id: o.ticketNo ?? 'x', ticketNo: 'CK-1', subject: 'Printer jammed', requester: 'Asha', technician: 'Krishan', category: 'Hardware', subCategory: 'Printer',
  service: 'IT Support', status: 'open', priority: 'medium', createdAt: '2026-10-01T10:00:00.000Z', ageDays: 3, ageBucket: '0–5 days', ...o,
})

const rows: DetailRow[] = [
  row({ ticketNo: 'CK-3', technician: 'Unassigned', ageDays: 50, ageBucket: '46–60 days' }),
  row({ ticketNo: 'CK-2', technician: 'Krishan', category: 'Software', ageDays: 8, ageBucket: '6–10 days' }),
  row({ ticketNo: 'CK-1', technician: 'Amit', ageDays: 2 }),
  row({ ticketNo: 'CK-4', technician: 'Krishan', category: 'Hardware', ageDays: 9, ageBucket: '6–10 days' }),
  row({ ticketNo: 'CK-5', technician: 'Krishan', category: 'Hardware', ageDays: 4 }),
]

describe('ticket detail helpers', () => {
  it('sorts by technician (Unassigned last), category, then oldest first', () => {
    expect(sortDetailRows(rows).map((r) => r.ticketNo)).toEqual(['CK-1', 'CK-4', 'CK-5', 'CK-2', 'CK-3'])
  })
  it('filters by technician and age bucket', () => {
    expect(filterDetailRows(rows, { technician: 'Krishan' })).toHaveLength(3)
    expect(filterDetailRows(rows, { bucket: '6–10 days' }).map((r) => r.ticketNo)).toEqual(['CK-2', 'CK-4'])
    expect(filterDetailRows(rows, {})).toHaveLength(5)
  })
  it('offers only technicians and buckets that have tickets', () => {
    expect(technicianOptions(rows)).toEqual(['Amit', 'Krishan', 'Unassigned'])
    expect(bucketOptions(rows)).toEqual(['0–5 days', '6–10 days', '46–60 days'])
  })
  it('totals tickets per bucket', () => {
    const buckets = detailBuckets(rows)
    expect(bucketTotals(rows, buckets)).toEqual({ '0–5 days': 2, '6–10 days': 2, '46–60 days': 1 })
  })
})

describe('ticket detail Excel', () => {
  const build = async (rs: DetailRow[]) => {
    const wb = buildTicketDetailWorkbook({
      title: 'BD Ticket Detail Report Age bucket wise', teamName: 'BD Group', rangeLabel: 'All time', statusLabels: ['Open'],
      servicesLabel: 'All services', extraFilters: '', rows: rs, statusLabel: (s) => s,
    })
    const buf = await wb.xlsx.writeBuffer()
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(buf)
    return back.getWorksheet('Tickets')!
  }
  it('keeps the summary columns, adds the ticket columns and has no created/resolved-today columns', async () => {
    const sheet = await build(sortDetailRows(rows))
    const head = (sheet.getRow(DETAIL_HEADER_ROW).values as unknown[]).slice(1).map(String)
    expect(head.slice(0, 3)).toEqual(['Responsible', 'Category', 'Sub Category'])
    expect(head.slice(3, 6)).toEqual(['Requester', 'Subject', 'Ticket No'])
    expect(head).toEqual(expect.arrayContaining([ '0–5 days', '6–10 days', '46–60 days', 'Grand Total']))
    expect(head.join('|')).not.toMatch(/today|Resolved/i)
    expect(head).toHaveLength(DETAIL_COLUMNS.length + 3 + 1)
  })
  it('puts a 1 in the ticket\'s bucket and sums them in the Grand Total line', async () => {
    const sheet = await build(sortDetailRows(rows))
    const lead = DETAIL_COLUMNS.length
    const first = sheet.getRow(DETAIL_HEADER_ROW + 1)
    expect(first.getCell(6).value).toBe('CK-1')
    expect(first.getCell(lead + 1).value).toBe(1) // 0–5 days
    expect(first.getCell(lead + 4).value).toBe(1) // grand total
    const grand = sheet.getRow(DETAIL_HEADER_ROW + 1 + rows.length)
    expect(grand.getCell(1).value).toBe('Grand Total')
    expect(grand.getCell(lead + 1).value).toBe(2)
    expect(grand.getCell(lead + 4).value).toBe(5)
  })
})
