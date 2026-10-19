// The sample file offered in "Upload Store Master": the right headings in the right order, two example rows
// and a how-to sheet. The first sheet is the one the upload reads.

import ExcelJS from 'exceljs'
import { STORE_MASTER_HEADINGS, AC_ONLY_FIELDS, type StoreMasterField } from './master-import'

/** Columns of the sample, in order: the store code, the details every store has, then the AC details. */
const GENERIC: StoreMasterField[] = ['city', 'state', 'cluster', 'region', 'priority_list', 'open_date', 'festival']
export const SAMPLE_FIELDS: (StoreMasterField | 'code')[] = ['code', ...GENERIC, ...AC_ONLY_FIELDS]

const WIDTH: Partial<Record<StoreMasterField | 'code', number>> = {
  code: 12, city: 24, state: 20, cluster: 11, region: 10, priority_list: 20, open_date: 14, festival: 22,
  ac_total: 10, ac_brand: 14, ac_amc_brand: 15, ac_amc_vendor: 26, zenatix: 10,
}

// Codes that cannot be real stores, so uploading the sample as it is changes nothing
const EXAMPLES: Record<string, string | number | Date>[] = [
  { code: 'SAMPLE1', city: 'ALLAHABAD CIVIL LINES', state: 'UTTAR PRADESH', cluster: 'UP5', region: 'R5', priority_list: 'Top 50', open_date: new Date(Date.UTC(2011, 9, 15)), festival: 'DIWALI|HOLI|EID', ac_total: 11, ac_brand: 'VOLTAS', ac_amc_brand: 'VOLTAS', ac_amc_vendor: 'EXAMPLE VENDOR', zenatix: 'Yes' },
  { code: 'SAMPLE2', city: 'NEW TOWN', state: 'ASSAM', cluster: 'NE', region: 'NSO', priority_list: 'ROS', open_date: 'Pending', festival: 'BIHU|PUJA|EID', ac_total: 8, ac_brand: 'DAIKIN', ac_amc_brand: 'DAIKIN', ac_amc_vendor: '', zenatix: 'No' },
]

const HOW_TO: string[] = [
  'How to fill the Store Master sheet',
  '',
  '1. Keep the headings in the first row of the first sheet exactly as they are. You can leave out any column you do not want to change.',
  '2. STORE is the store code (for example ALC). Stores are matched by this code. A code that is not in CK Desk is skipped unless you tick "Also add them as new stores" while uploading.',
  '3. Delete the two SAMPLE rows before uploading (they are examples; the codes SAMPLE1 and SAMPLE2 are not real stores).',
  '4. An empty cell is ignored: it never clears a value that is already saved. Words such as Pending, NA, TBD or - are treated as empty too.',
  '5. OPEN DATE: a date (for example 15/10/2011). Leave it empty while a store has not opened.',
  '6. ZENATIX: Yes or No.  AC TOTAL: a whole number.',
  '7. The AC columns (AC TOTAL, AC BRAND, AC-AMC BRAND, AC-AMC VENDOR, ZENATIX) are used for the AC service only. The other columns are for every store.',
  '8. Spelling that differs only by capital letters (Blue Star / BLUE STAR) is treated as one value. Use one spelling for one brand, cluster or vendor.',
  '9. You can also include NAME, ADDRESS, PIN CODE, OEM (the name of the AC OEM as set up in CK Desk), GENSET OEM (the name of its Genset OEM) and ACTIVE (Yes / No). An OEM of the wrong type in a column is refused.',
  '',
  'Tip: the Export button on the Stores tab gives a file in this same format with the current values, ready to edit and upload again.',
]

export function buildStoreMasterSampleWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'
  wb.created = new Date()

  const ws = wb.addWorksheet('Store Master', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] })
  const acStart = SAMPLE_FIELDS.findIndex((f) => f !== 'code' && AC_ONLY_FIELDS.includes(f)) + 1
  const header = ws.addRow(SAMPLE_FIELDS.map((f) => STORE_MASTER_HEADINGS[f]))
  header.eachCell((cell, col) => {
    // the AC-only columns are a different colour so it is clear which are which
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col >= acStart ? 'FF4EA72E' : 'FF1F4E79' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' }
  })
  header.height = 32

  for (const e of EXAMPLES) ws.addRow(SAMPLE_FIELDS.map((f) => e[f] ?? ''))
  SAMPLE_FIELDS.forEach((f, i) => { ws.getColumn(i + 1).width = WIDTH[f] ?? 16 })
  const dateCol = SAMPLE_FIELDS.indexOf('open_date') + 1
  ws.getColumn(dateCol).numFmt = 'dd/mm/yyyy'
  // Zenatix is Yes or No
  const zenCol = SAMPLE_FIELDS.indexOf('zenatix') + 1
  for (let r = 2; r <= 500; r++) ws.getCell(r, zenCol).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] }

  const how = wb.addWorksheet('How to fill')
  HOW_TO.forEach((line, i) => { const row = how.addRow([line]); if (i === 0) row.font = { bold: true, size: 13 } })
  how.getColumn(1).width = 140
  how.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'top' } })
  return wb
}
