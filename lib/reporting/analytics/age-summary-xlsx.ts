import ExcelJS from 'exceljs'
import type { AgeSummary } from './age-summary'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
const DAY_HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A6EA5' } }
const SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1F8' } }
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F2' } }
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFC8D6' } }, bottom: { style: 'thin', color: { argb: 'FFBFC8D6' } },
  left: { style: 'thin', color: { argb: 'FFBFC8D6' } }, right: { style: 'thin', color: { argb: 'FFBFC8D6' } },
}

/** Row where the table header sits (title, group, filters and "generated" lines come first). */
export const HEADER_ROW = 5

/** Excel workbook for a predefined age-bucket report — same layout as the on-screen table and the old Excel pivot. */
export function buildAgeBucketWorkbook(p: {
  title: string
  teamName: string
  rangeLabel: string
  statusLabels: string[]
  /** "All services" or the chosen service names. */
  servicesLabel: string
  /** "today" or "on 7 Oct 2026" — appears in the last three column headings. */
  dayWord: string
  ticketCount: number
  summary: AgeSummary
  generatedAt?: Date
}): ExcelJS.Workbook {
  const { summary } = p
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CityKart Desk'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: HEADER_ROW }] })
  const bucketCols = summary.buckets.length
  const dayStart = 3 + bucketCols + 2 // first of the three "that day" columns (1-based)

  sheet.addRow([p.title]).font = { bold: true, size: 14, color: { argb: 'FF1F2A44' } }
  sheet.addRow([`Technician group: ${p.teamName}   |   Services: ${p.servicesLabel}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Created: ${p.rangeLabel}   |   Status: ${p.statusLabels.join(', ')}   |   Tickets: ${p.ticketCount}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Generated ${(p.generatedAt ?? new Date()).toLocaleString('en-GB')}`]).font = { size: 9, italic: true, color: { argb: 'FF777777' } }

  const header = sheet.addRow([
    'Responsible', 'Category', 'Sub Category', ...summary.buckets, 'Grand Total',
    `Created ${p.dayWord}`, `Resolved ${p.dayWord}`, `Closed ${p.dayWord}`,
  ])
  header.eachCell((cell, col) => {
    cell.fill = col >= dayStart ? DAY_HEADER_FILL : HEADER_FILL
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.border = THIN
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: col > 3 ? 'center' : 'left' }
  })

  const num = (v: number | undefined) => v || ''
  const dayVals = (d: { created: number; resolved: number; closed: number }) => [num(d.created), num(d.resolved), num(d.closed)]
  for (const t of summary.technicians) {
    let first = true
    for (const c of t.categories) {
      c.subCategories.forEach((s, si) => {
        const row = sheet.addRow([first ? t.name : '', si === 0 ? c.name : '', s.name, ...summary.buckets.map((b) => num(s.counts[b])), s.total || '', ...dayVals(s.day)])
        first = false
        row.eachCell({ includeEmpty: true }, (cell) => { cell.border = THIN })
        row.getCell(1).font = { bold: true }
      })
    }
    const sub = sheet.addRow([`${t.name} Total`, '', '', ...summary.buckets.map((b) => num(t.counts[b])), t.total, ...dayVals(t.day)])
    sub.eachCell({ includeEmpty: true }, (cell) => { cell.fill = SUBTOTAL_FILL; cell.font = { bold: true }; cell.border = THIN })
  }
  if (summary.technicians.length === 0) {
    sheet.addRow(['No tickets match these filters.']).font = { italic: true }
  } else {
    const grand = sheet.addRow(['Grand Total', '', '', ...summary.buckets.map((b) => num(summary.grand.counts[b])), summary.grand.total, ...dayVals(summary.grand.day)])
    grand.eachCell({ includeEmpty: true }, (cell) => { cell.fill = TOTAL_FILL; cell.font = { bold: true }; cell.border = THIN })
  }

  sheet.getColumn(1).width = 24
  sheet.getColumn(2).width = 30
  sheet.getColumn(3).width = 30
  const lastCol = dayStart + 2
  for (let i = 4; i <= lastCol; i++) { sheet.getColumn(i).width = i >= dayStart ? 16 : 14; sheet.getColumn(i).alignment = { horizontal: 'center' } }
  sheet.getRow(HEADER_ROW).height = 30
  return workbook
}
