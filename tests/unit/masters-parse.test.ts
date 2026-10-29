import { describe, it, expect } from 'vitest'
import { parseAcSheet, parseGensetSheet, parseCvmSheet, toIsoDate } from '@/lib/masters/parse'
import { parseEmails, splitRecipients, isProbableTypoDomain } from '@/lib/masters/emails'
import { nextMasterSyncLabel, MASTER_SYNC_TIMES } from '@/lib/masters/schedule'

// The headings are those of the real sheets; the values are made up (no real address or serial in the repository).
const AC_HEAD = ['Store Code', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC-AMC vendor', 'AC-AMC Brand', 'Zenatix (yes/No)', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode', 'Status', 'Mail ID']
const ac = (store: string, no: unknown, serial: string, status = 'Active', mail = 'service@oem.test, ops@citykartstores.com') =>
  [store, 'GF_Ground Floor', 'Ductable', '5.5 TR', 'BLUESTAR', no, serial, 'BLUESTAR', 'STAR COOLING', 'NO', 'ROS', 'PUJA | DIWALI', 'R6', 'NE', 46250, 'Cooch Behar', 'WB', 'Khata 1437', 736101, status, mail]

describe('toIsoDate', () => {
  it('reads a sheet date number, ISO text and dd/mm/yyyy', () => {
    expect(toIsoDate('46250')).toBe('2026-08-16')
    expect(toIsoDate('2026-08-16')).toBe('2026-08-16')
    expect(toIsoDate('16/08/2026')).toBe('2026-08-16')
    expect(toIsoDate('')).toBeNull()
    expect(toIsoDate('soon')).toBeNull()
  })
})

describe('parseEmails', () => {
  it('splits, lower-cases and removes duplicates', () => {
    expect(parseEmails('A@x.com, b@x.com;a@x.com\n c@x.com').valid).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })
  it('keeps a broken piece out and reports it, the rest is still used', () => {
    const r = parseEmails('good@jakson.test,kuld,ep.singh1@jakson.test')
    expect(r.valid).toEqual(['good@jakson.test', 'ep.singh1@jakson.test'])
    expect(r.invalid).toEqual(['kuld'])
  })
  it('flags a misspelt company domain but still uses the address', () => {
    const r = parseEmails('raushan.kumar@citylartstores.com')
    expect(r.valid).toEqual(['raushan.kumar@citylartstores.com'])
    expect(r.typoDomains).toEqual(['raushan.kumar@citylartstores.com'])
    expect(isProbableTypoDomain('citykartstores.com')).toBe(false)
    expect(isProbableTypoDomain('bluestarindia.com')).toBe(false)
  })
})

describe('splitRecipients', () => {
  it('puts outside addresses in To and company addresses in CC', () => {
    expect(splitRecipients(['a@oem.test', 'x@citykartstores.com', 'y@citykart.org'])).toEqual({ to: ['a@oem.test'], cc: ['x@citykartstores.com', 'y@citykart.org'] })
  })
  it('when everybody is a company address they all go in To', () => {
    expect(splitRecipients(['x@citykartstores.com'])).toEqual({ to: ['x@citykartstores.com'], cc: [] })
  })
})

describe('parseAcSheet', () => {
  it('reads units, numbers as text, the date and the status', () => {
    const r = parseAcSheet([AC_HEAD, ac('cob', 1, 'SER-1'), ac('COB', 2, 'SER-2', 'Inactive')])
    expect(r.fatal).toBeUndefined()
    expect(r.rows.map((x) => [x.storeCode, x.ckdeskNo, x.isActive])).toEqual([['COB', '1', true], ['COB', '2', false]])
    expect(r.rows[0].openingDate).toBe('2026-08-16')
    expect(r.rows[0].emails).toEqual(['service@oem.test', 'ops@citykartstores.com'])
  })
  it('finds columns by heading wherever they are, and ignores extra columns', () => {
    const head = ['Extra', 'Mail ID', 'Store Code', 'AC CKDESK SERIAL NO']
    const r = parseAcSheet([head, ['x', 'a@oem.test', 'ALC', 3]])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ storeCode: 'ALC', ckdeskNo: '3', emails: ['a@oem.test'], isActive: true })
  })
  it('refuses a sheet that lost a required column (it is not applied)', () => {
    expect(parseAcSheet([['Store Code', 'Status'], ['ALC', 'Active']]).fatal).toMatch(/AC CKDESK SERIAL NO/)
    expect(parseAcSheet([]).fatal).toMatch(/empty/)
  })
  it('flags a duplicate number but keeps both rows', () => {
    const r = parseAcSheet([AC_HEAD, ac('PAR', 3, 'S-3'), ac('PAR', 3, 'S-3b')])
    expect(r.rows).toHaveLength(2)
    expect(r.issues.map((i) => i.code)).toContain('duplicate_number')
  })
  it('flags two serials that differ only by a dash', () => {
    const r = parseAcSheet([AC_HEAD, ac('PAR', 1, 'DSA661R3Q1HZF05319'), ac('PAR', 6, 'DSA661R3Q-1HZF05319')])
    expect(r.issues.map((i) => i.code)).toContain('similar_serial')
  })
  it('an unknown status counts as Inactive and is reported; a blank status counts as Active and is reported', () => {
    const r = parseAcSheet([AC_HEAD, ac('A', 1, 'a', 'Pending'), ac('A', 2, 'b', '')])
    expect(r.rows.map((x) => x.isActive)).toEqual([false, true])
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['unknown_status', 'blank_status']))
  })
  it('does not insist on an e-mail for an inactive AC, skips rows without store or number', () => {
    const r = parseAcSheet([AC_HEAD, ac('A', 1, 'a', 'Inactive', ''), ac('', 2, 'b'), ac('A', '', 'c')])
    expect(r.rows).toHaveLength(1)
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['blank_store', 'blank_number']))
    expect(r.issues.map((i) => i.code)).not.toContain('no_email')
  })
  it('keeps a serial exactly as typed (look-alike letters included)', () => {
    const odd = 'E412CBРЕ434664G'
    expect(parseAcSheet([AC_HEAD, ac('A', 1, odd)]).rows[0].serial).toBe(odd)
  })
})

describe('the same wrong address on many rows is one line on the health page', () => {
  it('groups a misspelt address found on several rows, with the rows and stores', () => {
    const r = parseAcSheet([AC_HEAD, ac('A', 1, 'a', 'Active', 'x@oem.test, boss@citylartstores.com'), ac('B', 1, 'b', 'Active', 'x@oem.test, boss@citylartstores.com'), ac('C', 1, 'c', 'Active', 'x@oem.test, other@citylartstores.com')])
    const typo = r.issues.filter((i) => i.code === 'probable_typo_domain')
    expect(typo).toHaveLength(2)                                       // boss@ on two rows (one line) and other@ on one row
    const grouped = typo.find((i) => /boss@citylartstores.com/.test(i.message))!
    expect(grouped.message).toMatch(/on 2 rows/)
    expect(grouped.message).toMatch(/stores A, B/)
  })
})

describe('parseGensetSheet', () => {
  const HEAD = ['Store Code', 'Genset Brand', 'Genset KVA', 'Genset Serial No', 'CPCB Group', 'Mail ID']
  it('reads rows and reports the broken and misspelt addresses', () => {
    const r = parseGensetSheet([HEAD, ['mdb', 'MAHINDRA', 40, 'N4T24M11510', 'CPCB-IV', 'spc@jakson.test,kuld,ep.singh1@jakson.test, raushan.kumar@citylartstores.com']])
    expect(r.rows[0]).toMatchObject({ storeCode: 'MDB', kva: '40', serial: 'N4T24M11510' })
    expect(r.rows[0].emails).toEqual(['spc@jakson.test', 'ep.singh1@jakson.test', 'raushan.kumar@citylartstores.com'])
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['bad_email', 'probable_typo_domain']))
  })
  it('reads the 2026-10-29 headings (Ticket Mail To, with empty PO Mail To / Quote Approval Mail To) and does not apply a sheet without an address column', () => {
    const NEW = ['Store Code', 'Genset Brand', 'Genset KVA', 'Genset Serial No', 'CPCB Group', 'Ticket Mail To', 'PO Mail To', 'Quote Approval Mail To']
    const r = parseGensetSheet([NEW, ['BTA', 'CUMMINS', 160, 'CJGS19093340/84897376', 'CPCB-II', 'spc@garudapower.com,singh.r@cummins.com', '', '']])
    expect(r.fatal).toBeUndefined()
    expect(r.rows[0]).toMatchObject({ storeCode: 'BTA', emails: ['spc@garudapower.com', 'singh.r@cummins.com'] })
    expect(parseGensetSheet([['Store Code', 'Genset Serial No', 'Anything'], ['BTA', '1', 'x@y.test']]).fatal).toContain('Ticket Mail To')
  })
  it('reports a store with two genset rows (and keeps both)', () => {
    const r = parseGensetSheet([HEAD, ['MCR', 'MAHINDRA', 125, 'SJMZA10569', 'CPCB-II', 'a@oem.test'], ['MCR', 'MAHINDRA', 125, 'NDJZB11872', 'CPCB-II', 'b@oem.test']])
    expect(r.rows).toHaveLength(2)
    expect(r.issues.map((i) => i.code)).toContain('store_has_several_gensets')
  })
})

describe('parseCvmSheet', () => {
  const HEAD = ['Store Code', 'CVM EMAIL ID']
  it('reads the store to CVM list', () => {
    const r = parseCvmSheet([HEAD, ['BKR', 'Vishal.Kumar@citykartstores.com'], ['CNW', 'vishal.kumar@citykartstores.com']])
    expect(r.rows.map((x) => [x.storeCode, x.cvmEmail])).toEqual([['BKR', 'vishal.kumar@citykartstores.com'], ['CNW', 'vishal.kumar@citykartstores.com']])
  })
  it('a store listed twice uses the first CVM, a bad address is skipped', () => {
    const r = parseCvmSheet([HEAD, ['BKR', 'a@citykartstores.com'], ['BKR', 'b@citykartstores.com'], ['CNW', 'nope']])
    expect(r.rows.map((x) => x.cvmEmail)).toEqual(['a@citykartstores.com'])
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['duplicate_store', 'bad_email']))
  })
})

describe('update times', () => {
  it('the sheets are copied three times a day', () => {
    expect([...MASTER_SYNC_TIMES]).toEqual(['11:00', '15:00', '19:00'])
  })
  it('names the next update (Indian time)', () => {
    expect(nextMasterSyncLabel(new Date('2026-10-19T04:00:00Z'))).toBe('today 11:00')   // 09:30 IST
    expect(nextMasterSyncLabel(new Date('2026-10-19T06:00:00Z'))).toBe('today 15:00')   // 11:30 IST
    expect(nextMasterSyncLabel(new Date('2026-10-19T10:00:00Z'))).toBe('today 19:00')   // 15:30 IST
    expect(nextMasterSyncLabel(new Date('2026-10-19T14:00:00Z'))).toBe('tomorrow 11:00') // 19:30 IST
  })
})
