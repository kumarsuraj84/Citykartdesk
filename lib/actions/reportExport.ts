'use server'

import ExcelJS from 'exceljs'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { fetchReportData, getReportFieldsForEntity } from '@/lib/queries/reporting'
import { computePivot, toFlatTable, type PivotConfig, type PivotRow } from '@/lib/reporting/pivot-engine'
import { REPORT_ENTITIES, RECORD_COUNT_FIELD, type EntityKey, type ReportField } from '@/lib/reporting/field-registry'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 }

function aggLabel(agg: string): string {
  const map: Record<string, string> = {
    sum: 'Sum', avg: 'Avg', min: 'Min', max: 'Max', count: 'Count',
    countDistinct: 'Distinct', countTrue: 'Yes', countFalse: 'No',
  }
  return map[agg] ?? agg
}

function fieldLabel(key: string, fields: ReportField[]): string {
  if (key === '__count__') return RECORD_COUNT_FIELD.label
  return fields.find((f) => f.key === key)?.label ?? key
}

function formatValue(v: string | number | boolean | null, type?: ReportField['type']): string | number {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return v
  if (type === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No'
  return String(v)
}

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return null
  return profile
}

export interface ReportExportConfig {
  mode: 'table' | 'pivot'
  columns: string[] // table mode
  pivot: PivotConfig // pivot mode
}

export async function exportReportXlsx(
  entity: EntityKey,
  config: ReportExportConfig
): Promise<{ data?: string; filename?: string; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const [allRows, fields] = await Promise.all([
    fetchReportData(entity, profile.org_id),
    getReportFieldsForEntity(entity, profile.org_id),
  ])
  const fieldsWithCount = [...fields, RECORD_COUNT_FIELD]

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CityKart Desk'
  workbook.created = new Date()

  const entityLabel = REPORT_ENTITIES[entity].label

  if (config.mode === 'table') {
    const cols = config.columns.length > 0 ? config.columns : fields.slice(0, 6).map((f) => f.key)
    const colFields = cols.map((key) => fieldsWithCount.find((f) => f.key === key)).filter((f): f is ReportField => !!f)
    const flatRows = toFlatTable(allRows.rows, config.pivot.filters, cols)

    const sheet = workbook.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = colFields.map((f) => ({ header: f.label, key: f.key, width: Math.max(14, f.label.length + 4) }))
    for (const row of flatRows) {
      sheet.addRow(Object.fromEntries(colFields.map((f) => [f.key, formatValue(row[f.key], f.type)])))
    }
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = HEADER_FILL
      cell.font = HEADER_FONT
      cell.alignment = { vertical: 'middle' }
    })
    if (flatRows.length > 0) {
      sheet.addTable({
        name: `${entity}Table`,
        ref: 'A1',
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: colFields.map((f) => ({ name: f.label, filterButton: true })),
        rows: flatRows.map((row) => colFields.map((f) => formatValue(row[f.key], f.type))),
      })
    }
  } else {
    const result = computePivot(allRows.rows, config.pivot, fieldsWithCount)
    const rowFieldLabels = config.pivot.rowFields.map((k) => fieldLabel(k, fieldsWithCount))
    const showColGroups = result.colLeaves.length > 1 || result.colLeaves[0]?.key !== '__all__'
    const valueCount = config.pivot.valueFields.length

    const sheet = workbook.addWorksheet('Pivot', { views: [{ state: 'frozen', xSplit: 1, ySplit: showColGroups ? 2 : 1 }] })

    // Header row(s)
    const headerRow1 = [rowFieldLabels.join(' / ') || 'All records']
    const headerRow2 = ['']
    for (const leaf of result.colLeaves) {
      for (const vf of config.pivot.valueFields) {
        headerRow1.push(showColGroups ? leaf.path.join(' / ') || 'Total' : `${aggLabel(vf.agg)} of ${fieldLabel(vf.field, fieldsWithCount)}`)
        headerRow2.push(showColGroups ? `${aggLabel(vf.agg)} of ${fieldLabel(vf.field, fieldsWithCount)}` : '')
      }
    }
    headerRow1.push('Total')
    headerRow2.push('')
    sheet.addRow(headerRow1)
    if (showColGroups) sheet.addRow(headerRow2)
    for (let i = 1; i <= (showColGroups ? 2 : 1); i++) {
      sheet.getRow(i).eachCell((cell) => {
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      })
    }

    function sumRowTotal(row: PivotRow): number | string {
      if (valueCount !== 1) return ''
      let total = 0
      let any = false
      for (const cell of row.cells) {
        const v = cell[0]
        if (typeof v === 'number') { total += v; any = true }
      }
      return any ? total : ''
    }

    function writeRow(row: PivotRow) {
      const cells: (string | number)[] = [`${'    '.repeat(row.depth)}${row.label}`]
      for (const cellSet of row.cells) {
        for (let vi = 0; vi < valueCount; vi++) {
          const v = cellSet[vi]
          cells.push(v === null || v === undefined ? '' : v)
        }
      }
      cells.push(sumRowTotal(row))
      const excelRow = sheet.addRow(cells)
      if (row.isSubtotal) {
        excelRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = SUBTOTAL_FILL })
      }
      for (const child of row.children) writeRow(child)
    }
    for (const row of result.rows) writeRow(row)

    const grandTotalCells: (string | number)[] = [`Grand Total (${result.totalRecords})`]
    for (const cellSet of result.grandTotal) {
      for (let vi = 0; vi < valueCount; vi++) {
        const v = cellSet[vi]
        grandTotalCells.push(v === null || v === undefined ? '' : v)
      }
    }
    grandTotalCells.push(valueCount === 1 ? result.grandTotal.reduce((sum: number, c) => (typeof c[0] === 'number' ? sum + (c[0] as number) : sum), 0) : '')
    const grandRow = sheet.addRow(grandTotalCells)
    grandRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = TOTAL_FILL })

    sheet.getColumn(1).width = 34
    for (let i = 2; i <= headerRow1.length; i++) sheet.getColumn(i).width = 16

    // Second sheet: raw underlying data as a native Excel Table, ready for the
    // user's own Insert → PivotTable (exceljs cannot emit a real PivotTable object).
    const rawFields = fields
    const rawSheet = workbook.addWorksheet('Raw Data', { views: [{ state: 'frozen', ySplit: 1 }] })
    rawSheet.columns = rawFields.map((f) => ({ header: f.label, key: f.key, width: Math.max(14, f.label.length + 4) }))
    const filteredRaw = toFlatTable(allRows.rows, config.pivot.filters, rawFields.map((f) => f.key))
    rawSheet.getRow(1).eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT })
    if (filteredRaw.length > 0) {
      rawSheet.addTable({
        name: `${entity}RawTable`,
        ref: 'A1',
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: rawFields.map((f) => ({ name: f.label, filterButton: true })),
        rows: filteredRaw.map((row) => rawFields.map((f) => formatValue(row[f.key], f.type))),
      })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const stamp = new Date().toISOString().slice(0, 10)
  return { data: base64, filename: `${entityLabel.toLowerCase()}-${config.mode}-${stamp}.xlsx` }
}
