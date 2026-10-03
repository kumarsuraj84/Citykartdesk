import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { previewXlsx, inspectZip, PreviewError, MAX_ROWS, MAX_COLS, MAX_SHEETS } from '@/lib/attachments/xlsx-preview'

async function build(fill: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  fill(wb)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('previewXlsx', () => {
  it('reads cells of every kind into plain text, per sheet', async () => {
    const buf = await build((wb) => {
      const a = wb.addWorksheet('Stock')
      a.addRow(['Item', 'Qty', 'When', 'Total'])
      a.addRow(['Router', 12, new Date(Date.UTC(2026, 9, 3)), { formula: 'B2*2', result: 24 }])
      a.addRow(['Rich', { richText: [{ text: 'Hel' }, { text: 'lo' }] }, new Date(Date.UTC(2026, 9, 3, 14, 5)), null])
      a.getCell('A4').value = { text: 'Site', hyperlink: 'https://x.com' }
      wb.addWorksheet('Second').addRow(['only'])
    })
    const out = await previewXlsx(buf)
    expect(out.sheets.map((s) => s.name)).toEqual(['Stock', 'Second'])
    expect(out.sheets[0].rows[0]).toEqual(['Item', 'Qty', 'When', 'Total'])
    expect(out.sheets[0].rows[1]).toEqual(['Router', '12', '2026-10-03', '24'])
    expect(out.sheets[0].rows[2]).toEqual(['Rich', 'Hello', '2026-10-03 14:05', ''])
    expect(out.sheets[0].rows[3][0]).toBe('Site')
    expect(out.sheets[0].truncated).toBe(false)
  })

  it('caps rows, columns and sheets, and says it was cut', async () => {
    const buf = await build((wb) => {
      const big = wb.addWorksheet('Big')
      for (let r = 1; r <= MAX_ROWS + 50; r++) big.addRow(Array.from({ length: MAX_COLS + 5 }, (_, c) => `r${r}c${c + 1}`))
      for (let i = 0; i < MAX_SHEETS + 2; i++) if (i > 0) wb.addWorksheet(`S${i}`).addRow(['x'])
    })
    const out = await previewXlsx(buf)
    const big = out.sheets[0]
    expect(big.rows).toHaveLength(MAX_ROWS)
    expect(big.rows[0]).toHaveLength(MAX_COLS)
    expect(big.totalRows).toBe(MAX_ROWS + 50)
    expect(big.totalCols).toBe(MAX_COLS + 5)
    expect(big.truncated).toBe(true)
    expect(out.sheets).toHaveLength(MAX_SHEETS)
    expect(out.sheetsTruncated).toBe(true)
  })

  it('skips hidden sheets and shows a merged range once', async () => {
    const buf = await build((wb) => {
      const s = wb.addWorksheet('Visible')
      s.addRow(['Title', '', ''])
      s.mergeCells('A1:C1')
      wb.addWorksheet('Hidden', { state: 'hidden' }).addRow(['secret'])
    })
    const out = await previewXlsx(buf)
    expect(out.sheets.map((s) => s.name)).toEqual(['Visible'])
    expect(out.sheets[0].rows[0]).toEqual(['Title', '', ''])
  })

  it('an empty sheet comes back with no rows', async () => {
    const buf = await build((wb) => { wb.addWorksheet('Empty') })
    const out = await previewXlsx(buf)
    expect(out.sheets[0].rows).toEqual([])
    expect(out.sheets[0].totalRows).toBe(0)
  })
})

describe('previewXlsx — refuses unsafe or unreadable files', () => {
  it('rejects something that is not a zip/xlsx', async () => {
    await expect(previewXlsx(Buffer.from('definitely not a workbook'))).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('rejects a file over the size cap', async () => {
    await expect(previewXlsx(Buffer.alloc(6 * 1024 * 1024))).rejects.toMatchObject({ code: 'too_large' })
  })

  it('rejects a workbook that would expand past the decompressed-size cap (zip-bomb guard)', async () => {
    const buf = await build((wb) => { wb.addWorksheet('S').addRow(['a', 'b']) })
    expect(inspectZip(buf).uncompressed).toBeGreaterThan(100)
    const err = await previewXlsx(buf, { maxUncompressed: 100 }).catch((e) => e)
    expect(err).toBeInstanceOf(PreviewError)
    expect(err.code).toBe('too_large')
  })
})
