import { describe, it, expect, vi } from 'vitest'
import { dateProblem, duplicateMappedHeading, parseAcSheet, parseGensetSheet, parsePmsSheet, shownText, toGrid, toIsoDate } from '@/lib/masters/parse'
import { parseProgramSheet } from '@/lib/programs/parse'
import { matchProgramRows } from '@/lib/programs/match'
import { canonicalJson, differs, recipientChangeIssues, refuseEmptySheet } from '@/lib/masters/sync'
import { fetchDisplaySafe } from '@/lib/masters/display'
import type { SheetsSource } from '@/lib/masters/google'
import { orderDue, MAX_PER_RUN, PMS_PROBLEM_DAYS } from '@/lib/pms/tickets'
import { pmsDueRange } from '@/lib/pms/window'

vi.mock('server-only', () => ({}))

// Audit hardening of the sheet readers (F-24, C-07, C-08, C-09, C-10, C-20/21, C-34, C-17).

const AC_HEAD = ['Store Code', 'AC CKDESK SERIAL NO', 'AC Serial No', 'Opening date', 'Status', 'Ticket Mail To']

describe('dates in a sheet (F-24)', () => {
  it('a day that does not exist is not a date (it would make the database refuse the whole copy)', () => {
    expect(toIsoDate('31/02/2026')).toBeNull()
    expect(toIsoDate('2026-02-30')).toBeNull()
    expect(toIsoDate('31-Apr-2026')).toBeNull()
    expect(dateProblem('31/02/2026')).toMatch(/not a day that exists/)
    expect(toIsoDate('29/02/2028')).toBe('2028-02-29')   // a real leap day
  })
  it('does not guess a 2-digit year or a month-first date, and says why', () => {
    expect(toIsoDate('25/10/26')).toBeNull()
    expect(dateProblem('25/10/26')).toMatch(/4 digits/)
    expect(toIsoDate('12/25/2026')).toBeNull()
    expect(dateProblem('12/25/2026')).toMatch(/day first/)
    expect(toIsoDate('03/04/2026')).toBe('2026-04-03')   // both parts could be a month: day first, as everywhere in CK Desk
  })
  it('an AC row with an opening date that cannot be read still imports, with a warning (so the store is not silently a new store forever)', () => {
    const r = parseAcSheet([AC_HEAD, ['ALC', 1, 'S1', '31/02/2026', 'Active', 'oem@oem.test'], ['ALC', 2, 'S2', 46250, 'Active', 'oem@oem.test']])
    expect(r.fatal).toBeUndefined()
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].openingDate).toBeNull()
    expect(r.rows[1].openingDate).toBe('2026-08-16')
    const w = r.issues.filter((i) => i.code === 'bad_opening_date')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ severity: 'warning', sheetRow: 2, storeCode: 'ALC' })
  })
})

describe('two columns with the same heading (C-09)', () => {
  it('an AC sheet with a heading CK Desk reads in two columns is not applied', () => {
    const r = parseAcSheet([['Store Code', 'AC CKDESK SERIAL NO', 'Ticket Mail To', 'Status', 'Status'], ['ALC', 1, 'oem@oem.test', 'Active', 'Inactive']])
    expect(r.fatal).toMatch(/"Status" in more than one column \(D, E\)/)
    expect(r.rows).toEqual([])
  })
  it('a repeated heading CK Desk does not read is harmless', () => {
    const r = parseAcSheet([[...AC_HEAD, 'Remarks', 'Remarks'], ['ALC', 1, 'S1', 46250, 'Active', 'oem@oem.test', 'a', 'b']])
    expect(r.fatal).toBeUndefined()
    expect(r.rows).toHaveLength(1)
  })
  it('the program sheet and the Genset sheet are checked the same way', () => {
    expect(parseProgramSheet([['Store Code', 'Ticket Mail To', 'Ticket Mail To'], ['A', 'a@v.test', 'b@v.test']], { name: 'RO', rowType: 'store' }).fatal).toMatch(/"Ticket Mail To" in more than one column \(B, C\)/)
    expect(parseGensetSheet([['Store Code', 'Ticket Mail To', 'Store Code'], ['A', 'a@v.test', 'B']]).fatal).toMatch(/"Store Code" in more than one column \(A, C\)/)
    expect(parsePmsSheet([['Store Code', 'AC PMS Date', 'AC PMS Date'], ['A', '25/10/2026', '26/10/2026']]).fatal).toMatch(/more than one column/)
    expect(duplicateMappedHeading(toGrid([['A', 'a']])!, ['a'], 'X')).toMatch(/"A" in more than one column \(A, B\)/)
  })
})

describe('what the sheet SHOWS (C-07)', () => {
  const head = ['Store Code', 'Machine No', 'Serial No', 'Ticket Mail To', 'Opening date', 'Batch']
  const raw = [head, ['ALC', 7, 1234567890123456, 'v@v.test', 40831, 7], ['ALC', 8, 'S8', 'v@v.test', 40832, 8]]
  const shown = [head, ['ALC', '007', '1234567890123456', 'v@v.test', '17/10/2011', '007'], ['ALC', '008', 'S8', 'v@v.test', '18/10/2011', '008']]

  it('machine number, serial and the extra columns are taken as shown, when the sheet was also read as shown', () => {
    const r = parseProgramSheet(raw, { name: 'RO', rowType: 'machine', display: shown })
    expect(r.rows[0]).toMatchObject({ machineNo: '007', serial: '1234567890123456', extra: { 'Opening date': '17/10/2011', Batch: '007' } })
    expect(r.rows[1]).toMatchObject({ machineNo: '008', serial: 'S8' })
  })
  it('without the second read the raw values are used (nothing breaks)', () => {
    const r = parseProgramSheet(raw, { name: 'RO', rowType: 'machine' })
    expect(r.rows[0]).toMatchObject({ machineNo: '7', extra: { 'Opening date': '40831', Batch: '7' } })
  })
  it('a row is never mixed up when the sheet was edited between the two reads (the store code must match)', () => {
    const moved = [head, ['XYZ', '999', 'OTHER', 'v@v.test', '01/01/2000', '999'], shown[2]]
    const r = parseProgramSheet(raw, { name: 'RO', rowType: 'machine', display: moved })
    expect(r.rows[0]).toMatchObject({ machineNo: '7', serial: '1234567890123456' })   // raw, not the other row's text
    expect(r.rows[1]).toMatchObject({ machineNo: '008' })
    expect(shownText(moved, raw, 2, 1, 0)).toBeNull()
    expect(shownText(shown, raw, 2, 1, 0)).toBe('007')
  })
  it('the AC sheet keeps the leading zeros of the number and every digit of the serial', () => {
    const a = parseAcSheet([AC_HEAD, ['ALC', 7, 1234567890123456, 46250, 'Active', 'oem@oem.test']], [AC_HEAD, ['ALC', '007', '1234567890123456', '16/08/2026', 'Active', 'oem@oem.test']])
    expect(a.rows[0]).toMatchObject({ ckdeskNo: '007', serial: '1234567890123456' })
  })
  it('a fake source: the shown read is used when it works and silently skipped when it fails or does not exist', async () => {
    const both: SheetsSource = { fetchValues: async () => raw, fetchDisplayValues: async () => shown }
    expect(await fetchDisplaySafe(both, 'id', null)).toEqual(shown)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: SheetsSource = { fetchValues: async () => raw, fetchDisplayValues: async () => { throw new Error('Google is busy') } }
    expect(await fetchDisplaySafe(broken, 'id', null)).toBeUndefined()
    log.mockRestore()
    expect(await fetchDisplaySafe({ fetchValues: async () => raw }, 'id', null)).toBeUndefined()
  })
})

describe('the Active column of a program sheet (C-08)', () => {
  const sheet = (active: string) => [['Store Code', 'Ticket Mail To', 'Active'], ['A', 'a@v.test', active]]
  it('clearly on is active, a blank cell is active', () => {
    for (const v of ['Active', 'yes', 'Y', 'TRUE', '1', '']) expect(parseProgramSheet(sheet(v), { name: 'RO', rowType: 'store' }).rows[0].isActive, v).toBe(true)
  })
  it('clearly off is inactive', () => {
    for (const v of ['No', 'Inactive', 'Not Active', 'closed']) expect(parseProgramSheet(sheet(v), { name: 'RO', rowType: 'store' }).rows[0].isActive, v).toBe(false)
  })
  it('anything else is inactive WITH a warning, like the AC sheet (Deactivated, Disabled, Not in use, N/A)', () => {
    for (const v of ['Deactivated', 'Disabled', 'Not in use', 'Closed store', 'N/A']) {
      const r = parseProgramSheet(sheet(v), { name: 'RO', rowType: 'store' })
      expect(r.rows[0].isActive, v).toBe(false)
      expect(r.issues.some((i) => i.code === 'unknown_active' && i.severity === 'warning'), v).toBe(true)
    }
  })
})

describe('machines with the same number are kept (C-30)', () => {
  it('both rows stay, with a warning that says so', () => {
    const r = parseProgramSheet([['Store Code', 'Ticket Mail To', 'Machine No', 'Serial No'], ['A', 'a@v.test', '7', 'S1'], ['A', 'a@v.test', '7', 'S2']], { name: 'RO', rowType: 'machine' })
    expect(r.rows.map((x) => x.serial)).toEqual(['S1', 'S2'])
    expect(r.issues.find((i) => i.code === 'duplicate_machine')?.message).toMatch(/Both are kept/)
  })
})

describe('rows that swap places keep their own history (C-34)', () => {
  const stored = (id: string, sheetRow: number) => ({ id, storeCode: 'A', machineNo: null, serial: null, vendor: '', sheetRow, removedAt: null, missingSince: null })
  const row = (sheetRow: number) => ({ sheetRow, storeCode: 'A', machineNo: '', serial: '', vendor: '', emails: [], poEmails: [], approverEmails: [], isActive: true, extra: {} })
  it('matches by the row each had last time, whatever order the stored rows come back in', () => {
    // stored X was on row 2, stored Y on row 3; the sheet still has rows 2 and 3
    const m = matchProgramRows([row(2), row(3)], [stored('Y', 3), stored('X', 2)], 'store')
    expect(m.matches.find((x) => x.rowIndex === 0)?.unitId).toBe('X')
    expect(m.matches.find((x) => x.rowIndex === 1)?.unitId).toBe('Y')
    expect(m.unmatched).toEqual([])
  })
  it('a new row among identical ones takes the free stored row, never steals one that has its own', () => {
    const m = matchProgramRows([row(2), row(3), row(4)], [stored('X', 2), stored('Y', 4)], 'store')
    expect(m.matches.find((x) => x.rowIndex === 0)?.unitId).toBe('X')
    expect(m.matches.find((x) => x.rowIndex === 2)?.unitId).toBe('Y')
    expect(m.inserts).toEqual([1])
  })
})

describe('the copy of a sheet', () => {
  it('keys in a different order are the same value (a row is not rewritten at every copy) (C-21)', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
    expect(differs({ extra: { 'Brand': 'X', 'Floor': 'GF' } }, { extra: { 'Floor': 'GF', 'Brand': 'X' } })).toBe(false)
    expect(differs({ extra: { Brand: 'X' } }, { extra: { Brand: 'Y' } })).toBe(true)
    expect(differs({ emails: ['a@x.test', 'b@x.test'] }, { emails: ['b@x.test', 'a@x.test'] })).toBe(true)   // a list is ordered
  })
  it('a sheet with headings but no data rows is refused while CK Desk holds rows, and accepted when it holds none (C-20)', async () => {
    const dbWith = (count: number) => ({ from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ count, error: null }) }) }) }) })
    expect(await refuseEmptySheet(dbWith(12), 'org', 'AC', 'master_ac_units', 0)).toMatch(/headings but no data rows.*12 current row/)
    expect(await refuseEmptySheet(dbWith(0), 'org', 'AC', 'master_ac_units', 0)).toBeNull()
    expect(await refuseEmptySheet(dbWith(12), 'org', 'AC', 'master_ac_units', 3)).toBeNull()
  })
  it('a change of where tickets and quotes go is reported as a warning, never blocks (C-10)', () => {
    const out = recipientChangeIssues('ac', [{ storeCode: 'ALC', label: 'Ticket Mail To', before: ['old@oem.test'], after: ['new@oem.test'] }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'ac', severity: 'warning', code: 'recipients_changed', storeCode: 'ALC' })
    expect(out[0].message).toMatch(/old@oem.test to new@oem.test/)
    const many = recipientChangeIssues('genset', Array.from({ length: 45 }, (_, i) => ({ storeCode: `S${i}`, label: 'Ticket Mail To', before: [], after: ['x@y.test'] })))
    expect(many).toHaveLength(31)
    expect(many[30].message).toMatch(/15 more/)
  })
})

describe('PMS tickets that are not reached or not made (C-17)', () => {
  const due = Array.from({ length: 6 }, (_, i) => ({ store_code: `S${i}`, pms_date: '2026-10-26' }))
  it('dates never tried come before dates that already failed, so failing stores cannot starve the rest; created dates are left out', () => {
    const status = (d: { store_code: string }) => ({ S0: 'failed', S1: 'skipped', S2: 'created', S3: undefined, S4: 'failed', S5: undefined } as Record<string, string | undefined>)[d.store_code]
    const { todo, created } = orderDue(due, status)
    expect(created).toBe(1)
    expect(todo.map((d) => d.store_code)).toEqual(['S3', 'S5', 'S0', 'S1', 'S4'])
  })
  it('one run makes at most 150; the rest wait for the next run of the same day', () => {
    expect(MAX_PER_RUN).toBe(150)
  })
  it('a problem stays in the list for 7 days after its day, while a past date is still never made', () => {
    expect(PMS_PROBLEM_DAYS).toBe(7)
    const r = pmsDueRange(new Date('2026-10-27T10:00:00Z'))
    expect(r.from).toBe(r.today)   // only today is made
    expect(r.today).toBe('2026-10-27')
  })
})
