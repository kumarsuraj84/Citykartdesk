import ExcelJS from 'exceljs'
import {
  flattenTree, treeColumns, treeCell, groupByLabel, NOTHING_COLLAPSED_TREE,
  type TicketTree, type TreeCollapsed, type TreeGroupBy,
} from './ticket-tree'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1F8' } }
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F2' } }
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFC8D6' } }, bottom: { style: 'thin', color: { argb: 'FFBFC8D6' } },
  left: { style: 'thin', color: { argb: 'FFBFC8D6' } }, right: { style: 'thin', color: { argb: 'FFBFC8D6' } },
}

/** Row where the table header sits (title, group, filters and "generated" lines come first). */
export const TREE_HEADER_ROW = 5

/** Excel workbook for the ticket status / store wise reports — the same rows as on screen, so what is folded on screen is folded in the file. */
export function buildTicketTreeWorkbook(p: {
  title: string
  teamName: string
  rangeLabel: string
  statusLabels: string[]
  servicesLabel: string
  /** e.g. "Responsible: Krishan · Stores with at least 2 tickets", or "". */
  extraFilters: string
  groupBy: TreeGroupBy
  tree: TicketTree
  collapsed?: TreeCollapsed
  statusLabel: (s: string) => string
  generatedAt?: Date
}): ExcelJS.Workbook {
  const { tree } = p
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CityKart Desk'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Tickets', { views: [{ state: 'frozen', ySplit: TREE_HEADER_ROW, xSplit: 2 }] })
  const cols = treeColumns(p.groupBy)
  const lead = 2 + cols.length // group, store, ticket columns

  sheet.addRow([p.title]).font = { bold: true, size: 14, color: { argb: 'FF1F2A44' } }
  sheet.addRow([`Technician group: ${p.teamName}   |   Services: ${p.servicesLabel}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Created: ${p.rangeLabel}   |   Status: ${p.statusLabels.join(', ')}${p.extraFilters ? `   |   ${p.extraFilters}` : ''}   |   Grouped by ${groupByLabel(p.groupBy)}   |   Tickets: ${tree.grand.total}`]).font = { size: 10, color: { argb: 'FF555555' } }
  sheet.addRow([`Generated ${(p.generatedAt ?? new Date()).toLocaleString('en-GB')}`]).font = { size: 9, italic: true, color: { argb: 'FF777777' } }

  const header = sheet.addRow([groupByLabel(p.groupBy), 'Store', ...cols.map((c) => c.label), ...tree.buckets, 'Grand Total'])
  header.eachCell((cell, col) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.border = THIN
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: col > lead ? 'center' : 'left' }
  })

  const num = (v: number | undefined) => v || ''
  if (tree.groups.length === 0) {
    sheet.addRow(['No tickets match these filters.']).font = { italic: true }
  } else {
    for (const r of flattenTree(tree, p.collapsed ?? NOTHING_COLLAPSED_TREE)) {
      const counts = tree.buckets.map((b) => num(r.counts[b]))
      if (r.kind === 'groupTotal') {
        const row = sheet.addRow([r.groupLabel, ...Array(lead - 1).fill(''), ...counts, r.total])
        row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = GROUP_FILL; cell.font = { bold: true }; cell.border = THIN })
        continue
      }
      const ticketCells = r.ticket ? cols.map((c) => treeCell(r.ticket!, c.key, p.statusLabel)) : cols.map(() => '')
      const row = sheet.addRow([r.groupLabel, r.storeLabel, ...ticketCells, ...counts, r.total])
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = THIN
        cell.alignment = { vertical: 'top', wrapText: cols[col - 3]?.key === 'subject', horizontal: col > lead || cols[col - 3]?.numeric ? 'center' : 'left' }
      })
      row.getCell(1).font = { bold: true }
      // a heading or store folded into one line of totals
      if (r.kind === 'group' || r.kind === 'store') row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = GROUP_FILL })
      if (r.kind === 'group') row.eachCell({ includeEmpty: true }, (cell) => { cell.font = { bold: true } })
    }
    const grand = sheet.addRow(['Grand Total', ...Array(lead - 1).fill(''), ...tree.buckets.map((b) => num(tree.grand.counts[b])), tree.grand.total])
    grand.eachCell({ includeEmpty: true }, (cell, col) => { cell.fill = TOTAL_FILL; cell.font = { bold: true }; cell.border = THIN; if (col > lead) cell.alignment = { horizontal: 'center' } })
  }

  sheet.getColumn(1).width = 24
  sheet.getColumn(2).width = 14
  cols.forEach((c, i) => { sheet.getColumn(i + 3).width = c.width })
  for (let i = lead + 1; i <= lead + tree.buckets.length + 1; i++) sheet.getColumn(i).width = 13
  sheet.getRow(TREE_HEADER_ROW).height = 22
  return workbook
}
