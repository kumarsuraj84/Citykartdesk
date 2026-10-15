import ExcelJS from 'exceljs'
import { inflateRawSync } from 'node:zlib'

// Reads an .xlsx attachment into plain rows for the preview popup. Runs on the server, on a file a
// logged-in user uploaded, so it is deliberately bounded: file size, decompressed size (a tiny
// "zip bomb" workbook can expand to gigabytes), and how many sheets/rows/columns are returned.

export const MAX_PREVIEW_FILE_BYTES = 5 * 1024 * 1024
export const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
const MAX_ZIP_ENTRIES = 2000
export const MAX_SHEETS = 10
export const MAX_ROWS = 200
export const MAX_COLS = 30

export type SheetPreview = {
  name: string
  rows: string[][]
  totalRows: number
  totalCols: number
  truncated: boolean
}
export type WorkbookPreview = { sheets: SheetPreview[]; sheetsTruncated: boolean }

export class PreviewError extends Error {
  constructor(public code: 'too_large' | 'unreadable') {
    super(code)
  }
}

/** Entry count and total decompressed size, read from the zip's central directory (no unzipping). */
export function inspectZip(buf: Buffer): { entries: number; uncompressed: number } {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new PreviewError('unreadable')
  const entries = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  let uncompressed = 0
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new PreviewError('unreadable')
    const size = buf.readUInt32LE(offset + 24)
    if (size === 0xffffffff) throw new PreviewError('too_large') // zip64: not a normal small workbook
    uncompressed += size
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32)
  }
  return { entries, uncompressed }
}

/**
 * The sizes written in a zip's directory are numbers its author chooses, so they prove nothing (VAPT VA-API-06 / VA-INT-04): a file can declare
 * 1 KB and unpack to gigabytes. This really unpacks every entry, with a hard output limit shared by the whole file, and refuses the file as soon as
 * the real total passes it. Memory use is bounded by `maxTotal` whatever the file claims.
 */
export function verifyZipRealSize(buf: Buffer, maxTotal: number): void {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new PreviewError('unreadable')
  const entries = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  let remaining = maxTotal
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new PreviewError('unreadable')
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const localHeader = buf.readUInt32LE(offset + 42)
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32)
    if (localHeader + 30 > buf.length || buf.readUInt32LE(localHeader) !== 0x04034b50) throw new PreviewError('unreadable')
    const start = localHeader + 30 + buf.readUInt16LE(localHeader + 26) + buf.readUInt16LE(localHeader + 28)
    if (start + compressedSize > buf.length) throw new PreviewError('unreadable')
    const data = buf.subarray(start, start + compressedSize)
    if (method === 0) { remaining -= data.length }
    else if (method === 8) {
      try { remaining -= inflateRawSync(data, { maxOutputLength: Math.max(1, remaining) }).length }
      catch (e) {
        if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new PreviewError('too_large')
        throw new PreviewError('unreadable')
      }
    } else throw new PreviewError('unreadable')
    if (remaining < 0) throw new PreviewError('too_large')
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const date = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
    const hasTime = v.getUTCHours() !== 0 || v.getUTCMinutes() !== 0
    return hasTime ? `${date} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : date
  }
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
    if ('formula' in v || 'sharedFormula' in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null)
    if ('hyperlink' in v) return cellText((v as { text?: ExcelJS.CellValue }).text ?? v.hyperlink)
    if ('error' in v) return String(v.error)
    return ''
  }
  return String(v)
}

export async function previewXlsx(
  buffer: Buffer,
  opts: { maxUncompressed?: number } = {}
): Promise<WorkbookPreview> {
  if (buffer.length > MAX_PREVIEW_FILE_BYTES) throw new PreviewError('too_large')
  const { entries, uncompressed } = inspectZip(buffer)
  if (entries > MAX_ZIP_ENTRIES || uncompressed > (opts.maxUncompressed ?? MAX_UNCOMPRESSED_BYTES)) {
    throw new PreviewError('too_large')
  }
  // the declared sizes can lie: check what the file really unpacks to before the spreadsheet reader sees it
  verifyZipRealSize(buffer, opts.maxUncompressed ?? MAX_UNCOMPRESSED_BYTES)

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as never)
  } catch {
    throw new PreviewError('unreadable')
  }

  const visible = workbook.worksheets.filter((ws) => ws.state === 'visible')
  const sheets: SheetPreview[] = visible.slice(0, MAX_SHEETS).map((ws) => {
    const totalRows = ws.actualRowCount > 0 ? ws.rowCount : 0
    const totalCols = ws.actualColumnCount > 0 ? ws.columnCount : 0
    const rowLimit = Math.min(totalRows, MAX_ROWS)
    const colLimit = Math.min(totalCols, MAX_COLS)
    const rows: string[][] = []
    for (let r = 1; r <= rowLimit; r++) {
      const row = ws.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= colLimit; c++) {
        const cell = row.getCell(c)
        // A merged range shows its text once, in its top-left cell.
        cells.push(cell.isMerged && cell.master !== cell ? '' : cellText(cell.value))
      }
      rows.push(cells)
    }
    return { name: ws.name, rows, totalRows, totalCols, truncated: totalRows > rowLimit || totalCols > colLimit }
  })

  return { sheets, sheetsTruncated: visible.length > MAX_SHEETS }
}
