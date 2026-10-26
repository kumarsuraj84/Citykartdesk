import { describe, expect, it } from 'vitest'
import { parsePmsSheet, toIsoDate } from '@/lib/masters/parse'
import { addDays, istNow, pmsDateLabel, pmsDueRange } from '@/lib/pms/window'
import { buildPmsResolutionText, checkVendorResolvePms } from '@/lib/vendor/fields'
import { isVendorTab, ticketsOfTab, waitingForVendor, type VendorTicketRow } from '@/lib/queries/vendor'

describe('the AC PMS sheet', () => {
  const head = ['Store Code', 'AC PMS Date']

  it('reads store and date, in any column order, with other columns ignored', () => {
    const r = parsePmsSheet([['City', 'AC PMS Date', 'Store Code'], ['Jaipur', '26/10/2026', 'jp1'], ['Delhi', '2026-11-02', 'DL2']])
    expect(r.fatal).toBeUndefined()
    expect(r.rows).toEqual([{ sheetRow: 2, storeCode: 'JP1', pmsDate: '2026-10-26' }, { sheetRow: 3, storeCode: 'DL2', pmsDate: '2026-11-02' }])
    expect(r.issues).toEqual([])
  })

  it('knows the usual ways a date is written (text, sheet serial number, long date, date with time)', () => {
    expect(toIsoDate('26/10/2026')).toBe('2026-10-26')
    expect(toIsoDate('26-10-2026')).toBe('2026-10-26')
    expect(toIsoDate('26-Oct-2026')).toBe('2026-10-26')
    expect(toIsoDate('26 October 2026')).toBe('2026-10-26')
    expect(toIsoDate('46321')).toBe('2026-10-26')
    const r = parsePmsSheet([head, ['A', '26/10/2026 09:00'], ['B', '46321']])
    expect(r.rows.map((x) => x.pmsDate)).toEqual(['2026-10-26', '2026-10-26'])
  })

  it('a store with no date is simply not due; a bad date and a real-looking impossible date are reported', () => {
    const r = parsePmsSheet([head, ['A', ''], ['B', 'next week'], ['C', '31/02/2026'], ['D', '05/11/2026']])
    expect(r.rows.map((x) => x.storeCode)).toEqual(['D'])
    expect(r.issues.map((i) => [i.code, i.storeCode, i.severity])).toEqual([['bad_date', 'B', 'error'], ['bad_date', 'C', 'error']])
    expect(r.issues[0].message).toContain('next week')
  })

  it('several dates for one store are fine; the same store and date twice counts once', () => {
    const r = parsePmsSheet([head, ['A', '01/11/2026'], ['A', '01/12/2026'], ['A', '01/11/2026']])
    expect(r.rows).toHaveLength(2)
    expect(r.issues.map((i) => i.code)).toEqual(['duplicate_row'])
  })

  it('a date with no store is reported; blank rows are ignored', () => {
    const r = parsePmsSheet([head, ['', '26/10/2026'], ['', ''], ['A', '27/10/2026']])
    expect(r.issues.map((i) => i.code)).toEqual(['blank_store'])
    expect(r.rows.map((x) => x.storeCode)).toEqual(['A'])
  })

  it('says which column is missing and refuses an empty sheet', () => {
    expect(parsePmsSheet([['Store Code', 'Notes']]).fatal).toContain('AC PMS Date')
    expect(parsePmsSheet([]).fatal).toContain('empty')
  })
})

describe('when a PMS date becomes a ticket', () => {
  it('uses India time: 08:59 is still the morning before, 09:00 opens the day', () => {
    expect(istNow(new Date('2026-10-26T03:29:00Z'))).toEqual({ date: '2026-10-26', minutes: 8 * 60 + 59 })
    const before = pmsDueRange(new Date('2026-10-26T03:29:00Z'))
    expect(before).toEqual({ from: '2026-10-24', to: '2026-10-25', todayOpen: false })
    const at = pmsDueRange(new Date('2026-10-26T03:30:00Z'))
    expect(at).toEqual({ from: '2026-10-24', to: '2026-10-26', todayOpen: true })
  })

  it('a late evening in UTC is already the next morning in India', () => {
    expect(istNow(new Date('2026-10-25T20:00:00Z')).date).toBe('2026-10-26')
  })

  it('counts days across a month end and writes dates for people', () => {
    expect(addDays('2026-11-01', -2)).toBe('2026-10-30')
    expect(pmsDateLabel('2026-10-05')).toBe('05 Oct 2026')
  })
})

describe('what the vendor does on an AC PMS ticket', () => {
  it('resolving needs the PMS report and nothing else', () => {
    expect(checkVendorResolvePms({ fsrCount: 0 })).toEqual({ ok: false, error: 'Please attach the PMS report before resolving.' })
    expect(checkVendorResolvePms({ fsrCount: 1 })).toEqual({ ok: true })
    expect(buildPmsResolutionText('  all 4 ACs serviced ')).toBe('AC PMS done. all 4 ACs serviced')
    expect(buildPmsResolutionText('')).toBe('AC PMS done.')
  })
})

describe('the two vendor tabs', () => {
  const row = (id: string, is_pms: boolean, box: VendorTicketRow['box']): VendorTicketRow => ({
    id, request_no: id, title: id, status: 'open', priority: 'medium', created_at: '', updated_at: '', assigned_to: null, assignee_name: null, store_code: null, store_name: null,
    ac_label: null, oem_ticket_no: null, reopen_count: 0, box, hold_kind: null, is_pms,
  })
  const rows = [row('a', false, 'open'), row('b', true, 'open'), row('c', true, 'revise_price'), row('d', false, 'resolved')]

  it('each ticket is in exactly one tab', () => {
    const main = ticketsOfTab(rows, 'tickets').map((r) => r.id)
    const pms = ticketsOfTab(rows, 'pms').map((r) => r.id)
    expect(main).toEqual(['a', 'd'])
    expect(pms).toEqual(['b', 'c'])
    expect(main.filter((id) => pms.includes(id))).toEqual([])
  })

  it('the number on a tab is what waits for the vendor in that tab only', () => {
    expect(waitingForVendor(ticketsOfTab(rows, 'tickets'))).toBe(1)
    expect(waitingForVendor(ticketsOfTab(rows, 'pms'))).toBe(2)
  })

  it('only the two known tab names are accepted from the address', () => {
    expect(isVendorTab('pms')).toBe(true)
    expect(isVendorTab('tickets')).toBe(true)
    expect(isVendorTab('other')).toBe(false)
    expect(isVendorTab(undefined)).toBe(false)
  })
})
