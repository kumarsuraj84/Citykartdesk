import ExcelJS from 'exceljs'
import { bucketOptions, type DetailRow } from './ticket-detail'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFC8D6' } }, bottom: { style: 'thin', color: { argb: 'FFBFC8D6' } },
  left: { style: 'thin', color: { argb: 'FFBFC8D6' } }, right: { style: 'thin', color: { argb: 'FFBFC8D6' } },
}

/** Row where the table header sits (title, group, filters and "generated" lines come first). */
export const DETAIL_HEADER_ROW = 5

/**
 * The columns of the detail report, shared by the screen and the Excel file so they never differ. The first
 * three are the summary's own (Responsible, Category, Sub Category); then Requester, Subject, Ticket No and the other details; then — as in the
 * summary — one column per age bucket (a 1 where the ticket falls) and a Grand Total, so the sums match.
 */
export const DETAIL_COLUMNS: { key: keyof DetailRow | 'createdDate'; label: string; width: number; numeric?: boolean }[] = [
  { key: 'technician', label: 'Responsible', width: 24 },
  { key: 'category', label: 'Category', width: 30 },
  { key: 'subCategory', label: 'Sub Category', width: 30 },
  { key: 'requester', label: 'Requester', width: 24 },
  { key: 'subject', label: 'Subject', width: 44 },
  { key: 'ticketNo', label: 'Ticket No', width: 14 },
  { key: 'service', label: 'Service', width: 24 },
  { key: 'status', label: 'Status', width: 16 },
  { key: 'priority', label: 'Priority', width: 11 },
  { key: 'createdDate', label: 'Created', width: 13 },
  { key: 'ageDays', label: 'Age (days)', width: 11, numeric: true },
]

/** The age-bucket columns: only buckets that have tickets, in age order (same rule as the summary). */
export function detailBuckets(rows: DetailRow[]): string[] { return bucketOptions(rows) }

/** Tickets per bucket and in total, for the Grand Total line. */
export function bucketTotals(rows: DetailRow[], buckets: string[]): Record<string, number> {
  const t: Record<string, number> = {}
  for (const b of buckets) t[b] = rows.filter((r) => r.ageBucket === b).length
  return t
}

/** dd Mon yyyy — in the server's local time zone (the same day the on-screen table shows). */
export function createdDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`
}

const cap = (s: string) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '')

export function cellValue(r: DetailRow, key: (typeof DETAIL_COLUMNS)[number]['key'], statusLabel: (s: string) => string): string | number {
  if (key === 'createdDate') return createdDate(r.createdAt)
  if (key === 'status') return statusLabel(r.status)
  if (key === 'priority') return cap(r.priority)
  const v = r[key]
  return typeof v === 'number' ? v : String(v ?? '')
}

/** Excel workbook for the ticket detail report — one line per ticket, same columns as on screen. */
export function buildTicketDetailWorkbook(p: {
  title: string
  teamName: string
  rangeLabel: string
  statusLabels: string[]
  servicesLabel: string
  /** e.g. "Responsible: Krishan · Age bucket: 0–5 days", or "" when neither filter is used. */
  extraFilters: string
  rows: DetailRow[]
  statusLabel: (s: string) => string
  generatedAt?: Date
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CityKart Desk'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Tickets', { views: [{ state: 'frozen', ySplit: DETAIL_HEADER_ROW, xSplit: 3 }] })

  sheet.addRow([p.title]).font = { bold: true, size: 14, color: { argb: 'FF1F2A44' } }
  sheet.addRow([`Technician group: ${p.teamName}   |   Services: ${p.servicesLabel}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Created: ${p.rangeLabel}   |   Status: ${p.statusLabels.join(', ')}${p.extraFilters ? `   |   ${p.extraFilters}` : ''}   |   Tickets: ${p.rows.length}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Generated ${(p.generatedAt ?? new Date()).toLocaleString('en-GB')}`]).font = { size: 9, italic: true, color: { argb: 'FF777777' } }

  const buckets = detailBuckets(p.rows)
  const lead = DETAIL_COLUMNS.length
  const header = sheet.addRow([...DETAIL_COLUMNS.map((c) => c.label), ...buckets, 'Grand Total'])
  header.eachCell((cell, col) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.border = THIN
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: col > lead ? 'center' : 'left' }
  })

  if (p.rows.length === 0) {
    sheet.addRow(['No tickets match these filters.']).font = { italic: true }
  } else {
    for (const r of p.rows) {
      const row = sheet.addRow([...DETAIL_COLUMNS.map((c) => cellValue(r, c.key, p.statusLabel)), ...buckets.map((b) => (r.ageBucket === b ? 1 : '')), 1])
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = THIN
        cell.alignment = { vertical: 'top', wrapText: col === 5, horizontal: col > lead || DETAIL_COLUMNS[col - 1]?.numeric ? 'center' : 'left' }
      })
      row.getCell(1).font = { bold: true }
    }
    const totals = bucketTotals(p.rows, buckets)
    const grand = sheet.addRow(['Grand Total', ...Array(lead - 1).fill(''), ...buckets.map((b) => totals[b] || ''), p.rows.length])
    grand.eachCell({ includeEmpty: true }, (cell, col) => { cell.fill = TOTAL_FILL; cell.font = { bold: true }; cell.border = THIN; if (col > lead) cell.alignment = { horizontal: 'center' } })
    sheet.autoFilter = { from: { row: DETAIL_HEADER_ROW, column: 1 }, to: { row: DETAIL_HEADER_ROW, column: lead + buckets.length + 1 } }
  }
  DETAIL_COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width })
  for (let i = lead + 1; i <= lead + buckets.length + 1; i++) sheet.getColumn(i).width = 13
  sheet.getRow(DETAIL_HEADER_ROW).height = 22
  return workbook
}
