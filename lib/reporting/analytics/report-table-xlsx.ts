import ExcelJS from 'exceljs'
import type { ReportTable } from './report-table'

// The Excel file of a fixed report: the same table as on screen (same colours, same lines), so what is exported is exactly what is shown.
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const HEAD_FILL = fill('FF4F81BD')
const PEACH_FILL = fill('FFFBD9C3')
const TECH_FILL = fill('FFDCE6F1')
const TOTAL_FILL = fill('FFB8CCE4')
const line = (argb: string): Partial<ExcelJS.Borders> => ({ top: { style: 'thin', color: { argb } }, bottom: { style: 'thin', color: { argb } }, left: { style: 'thin', color: { argb } }, right: { style: 'thin', color: { argb } } })
const GRID = line('FFBFC7D5')
const WHITE = line('FFFFFFFF')
const FONT = 'Calibri'

/** Row of the first heading line (title, scope and "generated" lines come first). */
export const XLSX_HEAD_ROW = 5

export function buildReportWorkbook(table: ReportTable, generatedAt: Date = new Date()): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'
  wb.created = new Date()
  // a sheet name is at most 31 characters and cannot hold some characters; the emoji of a title is left out
  const sheetName = table.title.replace(/[^\x20-\x7E]/g, '').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Report'
  const groups = table.headGroups.length > 0
  const headLast = XLSX_HEAD_ROW + (groups ? 1 : 0)
  const sheet = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: headLast, xSplit: table.lead }] })
  const cols = table.columns

  sheet.addRow([table.title]).font = { name: FONT, bold: true, size: 14, color: { argb: 'FF1F2A44' } }
  sheet.addRow([table.scopeText]).font = { name: FONT, size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Generated ${generatedAt.toLocaleString('en-GB')}`]).font = { name: FONT, size: 9, italic: true, color: { argb: 'FF777777' } }
  sheet.addRow([])

  // heading: an optional upper line for the groups, then the column names; peach columns span both lines
  if (groups) sheet.addRow([])
  sheet.addRow(cols.map((c) => c.label))
  for (const g of table.headGroups) {
    sheet.getCell(XLSX_HEAD_ROW, g.from + 1).value = g.label
    if (g.span > 1) sheet.mergeCells(XLSX_HEAD_ROW, g.from + 1, XLSX_HEAD_ROW, g.from + g.span)
  }
  for (let r = XLSX_HEAD_ROW; r <= headLast; r++) {
    cols.forEach((c, i) => {
      const cell = sheet.getCell(r, i + 1)
      if (groups && c.peach && r === XLSX_HEAD_ROW) { sheet.getCell(r, i + 1).value = c.label; sheet.mergeCells(r, i + 1, headLast, i + 1) }
      if (groups && c.peach && r === headLast) { cell.value = c.label }
      cell.fill = c.peach ? PEACH_FILL : HEAD_FILL
      cell.font = { name: FONT, bold: true, size: 11, color: { argb: c.peach ? 'FF1F2937' : 'FFFFFFFF' } }
      cell.border = WHITE
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c.peach || c.align === 'center' ? 'center' : c.align === 'right' ? 'right' : 'left' }
    })
  }
  for (const g of table.headGroups) sheet.getCell(XLSX_HEAD_ROW, g.from + 1).alignment = { horizontal: 'center', vertical: 'middle' }

  for (const r of table.rows) {
    const total = r.kind !== 'row'
    const row = sheet.addRow(r.cells.map((v) => (v === null ? '' : v)))
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.border = GRID
      cell.font = { name: FONT, size: 11, bold: total || i === 0 }
      cell.alignment = { horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' }
      if (c.pct && typeof cell.value === 'number') cell.numFmt = '0.0%'
      if (total) cell.fill = TOTAL_FILL
      else if (i === 0) cell.fill = TECH_FILL
    })
    if (total && table.lead > 1) sheet.mergeCells(row.number, 1, row.number, table.lead)
  }
  if (table.rows.length === 0) sheet.addRow(['No tickets for this report right now.']).font = { name: FONT, italic: true }

  cols.forEach((c, i) => { sheet.getColumn(i + 1).width = Math.max(8, Math.round(c.width / 7)) })
  sheet.getRow(headLast).height = 30
  return wb
}
