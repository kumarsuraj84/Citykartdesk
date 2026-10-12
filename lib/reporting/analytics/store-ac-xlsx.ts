import ExcelJS from 'exceljs'
import { flattenStoreAc, pctText, STORE_AC_GROUPS, STORE_AC_COLUMNS, type StoreAcGroupBy, type StoreAcReport } from './store-ac'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1F8' } }
const RED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE2E2' } }
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F2' } }
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFC8D6' } }, bottom: { style: 'thin', color: { argb: 'FFBFC8D6' } },
  left: { style: 'thin', color: { argb: 'FFBFC8D6' } }, right: { style: 'thin', color: { argb: 'FFBFC8D6' } },
}

export const STORE_AC_HEADER_ROW = 5

/** Excel workbook for the Store AC Not Working report: the same groups and stores as on screen. */
export function buildStoreAcWorkbook(p: {
  title: string
  teamName: string
  rangeLabel: string
  statusLabels: string[]
  servicesLabel: string
  filtersText: string
  redFlagPercent: number
  groupBy: StoreAcGroupBy
  report: StoreAcReport
  collapsed?: ReadonlySet<string>
  generatedAt?: Date
}): ExcelJS.Workbook {
  const { report, groupBy } = p
  const grouped = groupBy !== 'none'
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CityKart Desk'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Stores', { views: [{ state: 'frozen', ySplit: STORE_AC_HEADER_ROW, xSplit: grouped ? 2 : 1 }] })
  const lead = (grouped ? 1 : 0) + STORE_AC_COLUMNS.length

  sheet.addRow([p.title]).font = { bold: true, size: 14, color: { argb: 'FF1F2A44' } }
  sheet.addRow([`Technician group: ${p.teamName}   |   Services: ${p.servicesLabel}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Created: ${p.rangeLabel}   |   Status: ${p.statusLabels.join(', ')}${p.filtersText ? `   |   ${p.filtersText}` : ''}   |   Red flag: above ${p.redFlagPercent}%   |   Stores: ${report.grand.stores}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Generated ${(p.generatedAt ?? new Date()).toLocaleString('en-GB')}`]).font = { size: 9, italic: true, color: { argb: 'FF777777' } }

  const groupLabel = STORE_AC_GROUPS.find((g) => g.value === groupBy)?.label ?? ''
  const header = sheet.addRow([...(grouped ? [groupLabel] : []), ...STORE_AC_COLUMNS, ...report.buckets, 'Grand Total'])
  header.eachCell((cell, col) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.border = THIN
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: col > (grouped ? 2 : 1) ? 'center' : 'left' }
  })

  const num = (v: number | undefined) => v || ''
  // a group or grand-total line: a name, then only the AC total, open tickets and % filled in
  const summaryLine = (name: string, st: { acTotal: number; open: number; pct: number | null }) => [
    ...(grouped ? [name] : []),
    ...STORE_AC_COLUMNS.map((c, i) => (i === 0 && !grouped ? name : c === 'AC Total' ? st.acTotal || '' : c === 'Open AC Tickets' ? st.open || '' : c === 'AC Not Working %' ? pctText(st.pct) : '')),
  ]
  const counts = (c: Record<string, number>) => report.buckets.map((b) => num(c[b]))
  if (report.groups.length === 0) {
    sheet.addRow(['No stores match these filters.']).font = { italic: true }
  } else {
    for (const r of flattenStoreAc(report, p.collapsed ?? new Set(), groupBy)) {
      if (r.kind === 'group') {
        const g = r.group
        const row = sheet.addRow([...summaryLine(g.name, { acTotal: g.acTotal, open: g.openAcTickets, pct: g.pct }), ...counts(g.counts), g.total])
        row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = GROUP_FILL; cell.font = { bold: true }; cell.border = THIN })
        continue
      }
      const s = r.store!
      const row = sheet.addRow([
        ...(grouped ? [''] : []),
        s.store, s.city, s.cluster, s.region, s.priorityList, s.acBrand, s.acAmcBrand,
        s.acTotal ?? '', s.openAcTickets, pctText(s.pct), s.redFlag ? 'Red Flag' : s.pct == null ? '' : '-', s.zenatix,
        ...counts(s.counts), s.total,
      ])
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = THIN
        cell.alignment = { vertical: 'top', horizontal: col > (grouped ? 2 : 1) ? 'center' : 'left' }
        if (s.redFlag) cell.fill = RED_FILL
      })
    }
    const g = report.grand
    const grand = sheet.addRow([...summaryLine('Grand Total', { acTotal: g.acTotal, open: g.openAcTickets, pct: g.pct }), ...counts(g.counts), g.total])
    grand.eachCell({ includeEmpty: true }, (cell, col) => { cell.fill = TOTAL_FILL; cell.font = { bold: true }; cell.border = THIN; if (col > (grouped ? 2 : 1)) cell.alignment = { horizontal: 'center' } })
  }

  const widths = [...(grouped ? [20] : []), 12, 24, 11, 10, 20, 14, 15, 10, 14, 16, 11, 10]
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w })
  for (let i = lead + 1; i <= lead + report.buckets.length + 1; i++) sheet.getColumn(i).width = 13
  sheet.getRow(STORE_AC_HEADER_ROW).height = 32
  return workbook
}
