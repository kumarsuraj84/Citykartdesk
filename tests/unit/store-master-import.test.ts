import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { prepareStoreMaster, parseOpenDate, parseYesNo, normalizeHeader, AC_ONLY_FIELDS } from '@/lib/stores/master-import'
import { readStoreMasterFile } from '@/lib/stores/master-file'

const HEAD = ['STORE', 'AC TOTAL', 'AC BRAND', 'AC-AMC BRAND', 'AC-AMC VENDOR', 'ZENATIX', 'OPEN DATE', 'CITY', 'CLUSTER', 'REGION', 'STATE', 'PRIORITY LIST', 'FESTIVAL']
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('Store Master sheet: the facilities sheet as it is', () => {
  const rows = [
    [' lam ', 9, 'HITACHI-3rd', 'UMS', 'URBAN MARKETING-Direct', 'No', d('2011-07-01'), 'LUCKNOW ALAMBAGH', 'UP2', 'R4', 'UTTAR PRADESH', 'Top 50', 'DIWALI|HOLI|EID'],
    ['ALC', 11, 'Blue Star', 'BLUE STAR', 'Shivi Enterprises', 'YES', d('2011-10-15'), 'ALLAHABAD', 'UP5', 'R5', 'UTTAR PRADESH', 'Top 50', 'PUJA'],
    ['BLU', 8, 'BLUE STAR', 'BLUE STAR', 'Shivi Enterprises', 'No', d('2021-03-17'), 'X', 'UP5', 'R5', 'uttar pradesh', 'ROS', 'Pending'],
    ['NEW', 6, 'DAIKIN', 'DAIKIN', 'Pending', 'No', 'Pending', 'NEW CITY', 'CH1', 'NSO', 'ASSAM', 'ROS', ''],
  ]
  const p = prepareStoreMaster(HEAD, rows)

  it('understands every column and uses the store code, upper-cased and trimmed', () => {
    expect(p.recognised).toEqual(['ac_total', 'ac_brand', 'ac_amc_brand', 'ac_amc_vendor', 'zenatix', 'open_date', 'city', 'cluster', 'region', 'state', 'priority_list', 'festival'])
    expect(p.ignored).toEqual([])
    expect(p.entries.map((e) => e.code)).toEqual(['LAM', 'ALC', 'BLU', 'NEW'])
    expect(p.entries[0].values).toMatchObject({ ac_total: 9, zenatix: false, open_date: '2011-07-01', city: 'LUCKNOW ALAMBAGH', cluster: 'UP2', region: 'R4', priority_list: 'Top 50' })
    expect(p.entries[1].values.zenatix).toBe(true)
  })

  it('treats "Pending" as not set, in dates and in text columns, and says how many', () => {
    const neu = p.entries[3].values
    expect(neu.open_date).toBeUndefined()
    expect(neu.ac_amc_vendor).toBeUndefined()
    expect(p.entries[2].values.festival).toBeUndefined()
    expect(p.notes.join(' ')).toMatch(/3 cells say "Pending"/)
    expect(p.problems).toEqual([])
  })

  it('merges spellings that differ only by capitals, to the one used most', () => {
    expect(p.entries.map((e) => e.values.ac_brand)).toEqual(['HITACHI-3rd', 'BLUE STAR', 'BLUE STAR', 'DAIKIN'])
    expect(p.entries[2].values.state).toBe('UTTAR PRADESH')
    expect(p.notes.join(' ')).toContain('"Blue Star" / "BLUE STAR" treated as "BLUE STAR"')
  })
})

describe('headings and values', () => {
  it('finds columns by heading, in any case, with underscores or spaces, and keeps unknown ones aside', () => {
    expect(normalizeHeader('  AC_Total ')).toBe('ac total')
    const p = prepareStoreMaster(['Store Code', 'ac_total', 'Notes'], [['a1', 4, 'x']])
    expect(p.recognised).toEqual(['ac_total'])
    expect(p.ignored).toEqual(['Notes'])
    expect(p.entries[0]).toMatchObject({ code: 'A1', values: { ac_total: 4 } })
  })

  it('reads AMC BRAND / AMC VENDOR (the old sheet) as AC-AMC BRAND / AC-AMC VENDOR, and AC-AMC with a hyphen, space or underscore', () => {
    for (const [brand, vendor] of [['AMC BRAND', 'AMC VENDOR'], ['AC-AMC BRAND', 'AC-AMC VENDOR'], ['ac amc brand', 'ac amc vendor'], ['ac_amc_brand', 'ac_amc_vendor']]) {
      const p = prepareStoreMaster(['STORE', brand, vendor], [['A1', 'BLUE STAR', 'RAS ENGINEERING']])
      expect(p.recognised).toEqual(['ac_amc_brand', 'ac_amc_vendor'])
      expect(p.entries[0].values).toEqual({ ac_amc_brand: 'BLUE STAR', ac_amc_vendor: 'RAS ENGINEERING' })
    }
    expect(AC_ONLY_FIELDS).toEqual(['ac_total', 'ac_brand', 'ac_amc_brand', 'ac_amc_vendor', 'zenatix'])
  })

  it('an empty cell is left out so it never wipes a saved value', () => {
    const p = prepareStoreMaster(['STORE', 'AC TOTAL', 'CLUSTER'], [['A1', '', 'UP1'], ['A2', 3, '']])
    expect(p.entries[0].values).toEqual({ cluster: 'UP1' })
    expect(p.entries[1].values).toEqual({ ac_total: 3 })
  })

  it('reads dates as dates, text dates in the usual forms, and rejects nonsense', () => {
    expect(parseOpenDate(d('2026-10-02'))).toEqual({ date: '2026-10-02' })
    expect(parseOpenDate('02/10/2026')).toEqual({ date: '2026-10-02' })
    expect(parseOpenDate('2026-10-02')).toEqual({ date: '2026-10-02' })
    expect(parseOpenDate(46297)).toEqual({ date: '2026-10-02' })
    expect(parseOpenDate('Pending')).toEqual({ empty: true })
    expect(parseOpenDate('')).toEqual({ empty: true })
    expect(parseOpenDate('31/02/2026')).toHaveProperty('error')
    expect(parseOpenDate('soon-ish')).toHaveProperty('error')
  })

  it('reads Yes / No', () => {
    expect([parseYesNo('YES'), parseYesNo('No'), parseYesNo(true), parseYesNo(''), parseYesNo('maybe')]).toEqual([true, false, true, undefined, null])
  })

  it('skips a row with a bad value or a repeated code, and says which row and why', () => {
    const p = prepareStoreMaster(['STORE', 'AC TOTAL', 'ZENATIX'], [['A1', 'many', 'No'], ['A2', 3, 'Maybe'], ['A3', 2, 'Yes'], ['a3', 5, 'No'], ['', 1, 'No']])
    expect(p.entries.map((e) => e.code)).toEqual(['A3'])
    expect(p.problems).toEqual([
      'Row 2 (A1): AC TOTAL "many" must be a whole number, skipped.',
      'Row 3 (A2): ZENATIX "Maybe" must be Yes or No, skipped.',
      'Row 5: A3 is already on row 4, skipped.',
      'Row 6: store code is empty, skipped.',
    ])
  })

  it('needs the STORE column, and refuses a heading used twice', () => {
    expect(prepareStoreMaster(['AC TOTAL'], [[3]]).problems[0]).toMatch(/must be the store code/)
    const dup = prepareStoreMaster(['STORE', 'CLUSTER', 'cluster'], [['A', 'X', 'Y']])
    expect(dup.problems[0]).toMatch(/two columns for CLUSTER/)
    expect(dup.entries[0].values.cluster).toBe('X')
  })
})

describe('reading the uploaded file', () => {
  async function xlsx(build: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook()
    build(wb)
    const buf = await wb.xlsx.writeBuffer()
    return buf as ArrayBuffer
  }

  it('reads the first visible sheet, dates, numbers and formulas', async () => {
    const bytes = await xlsx((wb) => {
      const hidden = wb.addWorksheet('Lookup'); hidden.state = 'hidden'; hidden.addRow(['x'])
      const ws = wb.addWorksheet('Sheet1')
      ws.addRow(HEAD)
      ws.addRow(['LAM', { formula: '4+5', result: 9 }, 'HITACHI', 'UMS', 'V', 'No', d('2011-07-01'), 'C', 'UP2', 'R4', 'UP', 'Top 50', 'DIWALI'])
    })
    // the hidden sheet was added first but the visible one is read
    const t = await readStoreMasterFile('master.xlsx', bytes)
    if ('error' in t) throw new Error(t.error)
    const p = prepareStoreMaster(t.headers, t.rows)
    expect(p.entries).toHaveLength(1)
    expect(p.entries[0].values).toMatchObject({ ac_total: 9, open_date: '2011-07-01', zenatix: false })
  })

  it('reads a CSV, with or without a byte-order mark', async () => {
    const csv = '﻿STORE,AC TOTAL,CLUSTER\nA1,3,UP1\nA2,,UP2\n'
    const t = await readStoreMasterFile('m.csv', new TextEncoder().encode(csv).buffer as ArrayBuffer)
    if ('error' in t) throw new Error(t.error)
    expect(prepareStoreMaster(t.headers, t.rows).entries.map((e) => e.values)).toEqual([{ ac_total: 3, cluster: 'UP1' }, { cluster: 'UP2' }])
  })

  it('gives plain messages for files it cannot use', async () => {
    const e = async (name: string, bytes: ArrayBuffer) => ((await readStoreMasterFile(name, bytes)) as { error: string }).error
    expect(await e('a.xls', new Uint8Array([1]).buffer as ArrayBuffer)).toMatch(/\.xlsx/)
    expect(await e('a.pdf', new Uint8Array([1]).buffer as ArrayBuffer)).toMatch(/Excel \(\.xlsx\) or CSV/)
    expect(await e('a.xlsx', new Uint8Array([1, 2, 3]).buffer as ArrayBuffer)).toMatch(/not a valid \.xlsx/)
    expect(await e('a.csv', new ArrayBuffer(0))).toMatch(/empty/)
    expect(await e('a.csv', new TextEncoder().encode('STORE\n').buffer as ArrayBuffer)).toMatch(/no store rows/)
  })
})
