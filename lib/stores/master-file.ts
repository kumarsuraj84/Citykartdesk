// Turns an uploaded Store Master file (.xlsx or .csv) into a header row and data rows, ready for prepareStoreMaster().
// Server side only (uses exceljs).

import ExcelJS from 'exceljs'
import { parseCSV } from '@/lib/import/csv'
import { inspectZip, verifyZipRealSize } from '@/lib/attachments/xlsx-preview'

export const MAX_STORE_FILE_BYTES = 5 * 1024 * 1024
export const MAX_STORE_FILE_ROWS = 5000
export const MAX_STORE_FILE_COLUMNS = 100
export const MAX_STORE_UNCOMPRESSED_BYTES = 40 * 1024 * 1024
export const MAX_STORE_ZIP_ENTRIES = 500

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
    // An .xlsx is a zip file. The sizes written inside it can lie, so before the spreadsheet reader sees it (VAPT-068 / VA-ADM-18): the number of parts and the
    // declared unpacked size are read from the zip's index, and what it REALLY unpacks to is measured with a hard stop. A small crafted file that expands to
    // gigabytes, or declares a sheet with millions of columns, is refused here instead of exhausting the server's memory.
    const buf = Buffer.from(bytes)
    try {
      const { entries, uncompressed } = inspectZip(buf)
      if (entries > MAX_STORE_ZIP_ENTRIES || uncompressed > MAX_STORE_UNCOMPRESSED_BYTES) return { error: 'The workbook is too large when unpacked.' }
      verifyZipRealSize(buf, MAX_STORE_UNCOMPRESSED_BYTES)
    } catch {
      return { error: 'This is not a valid .xlsx file, or it is too large when unpacked.' }
    }
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(bytes)
    } catch {
      return { error: 'This is not a valid .xlsx file.' }
    }
    // the first sheet that is shown (a hidden sheet is usually a lookup table)
    const sheet = wb.worksheets.find((s) => s.state === 'visible') ?? wb.worksheets[0]
    if (!sheet) return { error: 'The workbook has no sheets.' }
    // a sheet that only claims a huge area (a stray cell far away) is refused before any loop runs over it
    if (sheet.columnCount > MAX_STORE_FILE_COLUMNS) return { error: `The sheet has more than ${MAX_STORE_FILE_COLUMNS} columns.` }
    if (sheet.rowCount > MAX_STORE_FILE_ROWS * 4) return { error: `The sheet has more than ${MAX_STORE_FILE_ROWS} rows.` }
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
