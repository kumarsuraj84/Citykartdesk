// Turns an uploaded Store Master file (.xlsx or .csv) into a header row and data rows, ready for prepareStoreMaster().
// Server side only (uses exceljs).

import ExcelJS from 'exceljs'
import { parseCSV } from '@/lib/import/csv'

export const MAX_STORE_FILE_BYTES = 5 * 1024 * 1024
export const MAX_STORE_FILE_ROWS = 5000

export interface StoreMasterTable { headers: unknown[]; rows: unknown[][] }

/** One cell's value: formulas give their result, links and rich text their text, dates stay dates. */
function plain(v: ExcelJS.CellValue): unknown {
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if ('result' in o) return plain(o.result as ExcelJS.CellValue)
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('')
    if (typeof o.text === 'string') return o.text
    if ('error' in o) return ''
    return ''
  }
  return v
}

export async function readStoreMasterFile(fileName: string, bytes: ArrayBuffer): Promise<{ error: string } | StoreMasterTable> {
  const lower = fileName.toLowerCase()
  if (bytes.byteLength === 0) return { error: 'The file is empty.' }
  if (bytes.byteLength > MAX_STORE_FILE_BYTES) return { error: 'The file is larger than 5 MB.' }

  let table: unknown[][]
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(bytes)
    } catch {
      return { error: 'This is not a valid .xlsx file.' }
    }
    // the first sheet that is shown (a hidden sheet is usually a lookup table)
    const sheet = wb.worksheets.find((s) => s.state === 'visible') ?? wb.worksheets[0]
    if (!sheet) return { error: 'The workbook has no sheets.' }
    const width = sheet.columnCount
    table = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: unknown[] = []
      for (let c = 1; c <= width; c++) cells.push(plain(row.getCell(c).value))
      table.push(cells)
    })
  } else if (lower.endsWith('.csv')) {
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes)
    }
    table = parseCSV(text.replace(/^﻿/, ''))
  } else if (lower.endsWith('.xls')) {
    return { error: 'Old .xls files are not supported. In Excel choose Save As → Excel Workbook (.xlsx) and upload that.' }
  } else {
    return { error: 'Upload an Excel (.xlsx) or CSV file.' }
  }

  if (table.length < 2) return { error: 'The file has no store rows (the first row must be the headings).' }
  if (table.length - 1 > MAX_STORE_FILE_ROWS) return { error: `The file has more than ${MAX_STORE_FILE_ROWS} rows.` }
  return { headers: table[0], rows: table.slice(1) }
}
