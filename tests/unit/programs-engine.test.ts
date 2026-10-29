// Vendor Programs (docs/VENDOR-PROGRAMS-DESIGN.md): the pure parts of the engine - reading the sheet, recognising rows again, and the mail fields.
import { describe, it, expect } from 'vitest'
import { headingKeys, parseProgramSheet } from '@/lib/programs/parse'
import { matchProgramRows } from '@/lib/programs/match'
import { allowedFields, DEFAULT_PROGRAM_BODY, extraKey, programVars, unknownFields } from '@/lib/programs/mail'
import { renderMasterMail } from '@/lib/masters/mail'
import { slugify, type ParsedProgramRow, type StoredProgramRow } from '@/lib/programs/types'

const sheet = (...rows: unknown[][]) => rows

describe('reading a program sheet (one row per store)', () => {
  const head = ['Store Code', 'Mail To', 'Vendor', 'Serial No', 'Brand Name', 'Active']
  it('reads the usual headings in any order and keeps every other column as an extra detail', () => {
    const r = parseProgramSheet(sheet(['Notes', 'Vendor', 'store code', 'MAIL TO', 'Brand Name'], ['n1', 'Aqua Care', 'alc', 'svc@aqua.test, boss@citykartstores.com', 'KENT']), { name: 'RO', rowType: 'store' })
    expect(r.fatal).toBeUndefined()
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ storeCode: 'ALC', vendor: 'Aqua Care', emails: ['svc@aqua.test', 'boss@citykartstores.com'], isActive: true })
    expect(r.rows[0].extra).toEqual({ Notes: 'n1', 'Brand Name': 'KENT' })
  })
  it('refuses a sheet that lost a required column and says which, so the last good copy stays in use', () => {
    const r = parseProgramSheet(sheet(['Store Code', 'Vendor'], ['ALC', 'x']), { name: 'RO', rowType: 'store' })
    expect(r.fatal).toMatch(/missing the column\(s\): Mail to/)
    expect(parseProgramSheet([], { name: 'RO', rowType: 'store' }).fatal).toMatch(/empty/)
  })
  it('skips a row without a store and reports it; a row without a usable mail address is kept and reported', () => {
    const r = parseProgramSheet(sheet(head, ['', 'a@v.test', 'V', '', '', ''], ['ALC', '', 'V', '', '', ''], ['BKN', 'not-an-address', 'V', '', '', '']), { name: 'RO', rowType: 'store' })
    expect(r.rows.map((x) => x.storeCode)).toEqual(['ALC', 'BKN'])
    expect(r.issues.map((i) => i.code).sort()).toEqual(['bad_email', 'blank_store', 'no_email', 'no_valid_email'])
  })
  it('one wrong address on many rows is one line; a typo in a company domain is flagged', () => {
    const rows = Array.from({ length: 5 }, (_, i) => [`S${i}`, 'oops, ok@v.test', 'V', '', '', ''])
    const r = parseProgramSheet(sheet(head, ...rows, ['TYP', 'x@citylartstores.com', 'V', '', '', '']), { name: 'RO', rowType: 'store' })
    expect(r.issues.filter((i) => i.code === 'bad_email')).toHaveLength(1)
    expect(r.issues.find((i) => i.code === 'bad_email')!.message).toMatch(/on 5 rows/)
    expect(r.issues.some((i) => i.code === 'probable_typo_domain')).toBe(true)
  })
  it('Active = no / 0 / false takes a row out of use; empty means active', () => {
    const r = parseProgramSheet(sheet(head, ['A', 'a@v.test', 'V', '', '', 'No'], ['B', 'b@v.test', 'V', '', '', ''], ['C', 'c@v.test', 'V', '', '', '0']), { name: 'RO', rowType: 'store' })
    expect(r.rows.map((x) => x.isActive)).toEqual([false, true, false])
  })
  it('a store with several rows is a warning (all of them are mailed together)', () => {
    const r = parseProgramSheet(sheet(head, ['A', 'a@v.test', 'V1', '', '', ''], ['A', 'b@v.test', 'V2', '', '', '']), { name: 'RO', rowType: 'store' })
    expect(r.issues.some((i) => i.code === 'store_has_several_rows')).toBe(true)
  })
})

describe('reading a program sheet (one row per machine)', () => {
  it('needs the machine number, skips a row without it and warns about the same machine twice', () => {
    const head = ['Store Code', 'Mail To', 'Machine No', 'Serial']
    const r = parseProgramSheet(sheet(head, ['ALC', 'a@v.test', '1', 'S1'], ['ALC', 'a@v.test', '', 'S2'], ['ALC', 'a@v.test', '1', 'S3']), { name: 'RO', rowType: 'machine' })
    expect(r.rows.map((x) => x.machineNo)).toEqual(['1', '1'])
    expect(r.issues.map((i) => i.code).sort()).toEqual(['blank_machine', 'duplicate_machine'])
    expect(parseProgramSheet(sheet(['Store Code', 'Mail To'], ['A', 'a@v.test']), { name: 'RO', rowType: 'machine' }).fatal).toMatch(/Machine number/)
  })
})

describe('headings an administrator typed', () => {
  it('are tried first, the usual names still work, and both can be used', () => {
    expect(headingKeys('mail', { mail: 'Service Desk Mail' })[0]).toBe('servicedeskmail')
    expect(headingKeys('mail', { mail: 'Service Desk Mail' })).toContain('mailto')
    const r = parseProgramSheet(sheet(['Outlet', 'Service Desk Mail'], ['alc', 'sd@v.test']), { name: 'RO', rowType: 'store', columns: { store: 'Outlet', mail: 'Service Desk Mail' } })
    expect(r.rows[0]).toMatchObject({ storeCode: 'ALC', emails: ['sd@v.test'] })
  })
})

const row = (o: Partial<ParsedProgramRow>): ParsedProgramRow => ({ sheetRow: 2, storeCode: 'A', machineNo: '', serial: '', vendor: '', emails: [], poEmails: [], approverEmails: [], isActive: true, extra: {}, ...o })
const stored = (id: string, o: Partial<StoredProgramRow>): StoredProgramRow => ({ id, storeCode: 'A', machineNo: null, serial: null, vendor: null, removedAt: null, missingSince: null, ...o })

describe('recognising a row again after the sheet changes', () => {
  it('machine program: by store and machine number; a renumbered machine with the same serial is the same machine; a gone row is reported missing', () => {
    const m = matchProgramRows([row({ machineNo: '1', serial: 'S1' }), row({ machineNo: '9', serial: 'S2' }), row({ machineNo: '7' })], [stored('x1', { machineNo: '1', serial: 'S1' }), stored('x2', { machineNo: '2', serial: 'S2' }), stored('x3', { machineNo: '3', serial: 'S3' })], 'machine')
    expect(m.matches).toEqual([{ rowIndex: 0, unitId: 'x1' }, { rowIndex: 1, unitId: 'x2' }])
    expect(m.inserts).toEqual([2])
    expect(m.unmatched).toEqual(['x3'])
  })
  it('store program: by store and vendor; a corrected vendor name on a one-row store is the same row', () => {
    const m = matchProgramRows([row({ vendor: 'Aqua Care' }), row({ storeCode: 'B', vendor: 'Aqua Care Ltd' })], [stored('s1', { vendor: 'aqua care' }), stored('s2', { storeCode: 'B', vendor: 'Aqua Care' })], 'store')
    expect(m.matches).toEqual([{ rowIndex: 0, unitId: 's1' }, { rowIndex: 1, unitId: 's2' }])
    expect(m.inserts).toEqual([])
  })
  it('a removed row comes back to life, and a current row is preferred over a removed one', () => {
    const m = matchProgramRows([row({ machineNo: '1' })], [stored('old', { machineNo: '1', removedAt: '2026-01-01' }), stored('now', { machineNo: '1' })], 'machine')
    expect(m.matches).toEqual([{ rowIndex: 0, unitId: 'now' }])
    const back = matchProgramRows([row({ machineNo: '1' })], [stored('old', { machineNo: '1', removedAt: '2026-01-01' })], 'machine')
    expect(back.matches).toEqual([{ rowIndex: 0, unitId: 'old' }])
  })
})

describe('the mail of a program', () => {
  const rec = (o: object) => ({ id: 'r', store_code: 'ALC', machine_no: null, serial: null, vendor: null, emails: [], po_emails: [], approver_emails: [], extra: {}, is_active: true, sheet_row: 2, ...o }) as never
  it('fills the details of every row of the store and the extra sheet columns', () => {
    const v = programVars({ name: 'RO Water Purifier', row_type: 'machine' }, [rec({ machine_no: '1', serial: 'S1', vendor: 'Aqua', extra: { 'Brand Name': 'KENT' } }), rec({ machine_no: '2', vendor: 'Aqua', extra: { 'Brand Name': 'PUREIT' } })])
    expect(v.program).toBe('RO Water Purifier')
    expect(v.vendor).toBe('Aqua')
    expect(v.machine_no).toBe('1 / 2')
    expect(v.details).toBe('Machine 1, serial S1, Aqua\nMachine 2, Aqua')
    expect(v[extraKey('Brand Name')]).toBe('KENT / PUREIT')
    expect(extraKey('Brand Name')).toBe('extra_brandname')
  })
  it('the default mail is a table with the store, vendor and machine rows, and renders with ticket text escaped', () => {
    const vars = { ticket_no: 'CKSD-1', subject: 'Water <b>bad</b>', description: 'x', requester_name: 'S', requester_email: 's@c.test', requester_phone: '1', store_address: 'a', store_code: 'ALC', category: 'RO', ...programVars({ name: 'RO', row_type: 'store' }, [rec({ vendor: 'Aqua' })]) }
    const m = renderMasterMail({ subject: 'New {{program}} Ticket - {{ticket_no}} - {{store_code}}', body: DEFAULT_PROGRAM_BODY }, vars)
    expect(m.subject).toBe('New RO Ticket - CKSD-1 - ALC')
    expect(m.html).toContain('<table')
    expect(m.html).toContain('Aqua')
    expect(m.html).not.toContain('<b>bad</b>')
    expect(m.text).toMatch(/^Store Code \| ALC$/m)
  })
  it('a mistyped {{field}} is found before it goes live', () => {
    const allowed = allowedFields(['Brand Name'])
    expect(unknownFields('Hello {{ticket_no}} {{extra_brandname}} {{store_cod}} {{vendr}}', allowed)).toEqual(['store_cod', 'vendr'])
    expect(unknownFields(DEFAULT_PROGRAM_BODY, allowed)).toEqual([])
  })
  it('a program name makes a clean web name', () => {
    expect(slugify('RO Water Purifier (Kent)!')).toBe('ro-water-purifier-kent')
  })
})
