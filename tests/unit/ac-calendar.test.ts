// The AC Calendar's arithmetic: IST days, faulty-at-end-of-day, the colour limits (green 0, light green up to 10%, yellow above 10%, red above 30%, grey for the future),
// repeat-fault ACs (4+ tickets in 90 days; 2-3 watch), "came back within 30 days", and the worst places.
import { describe, it, expect } from 'vitest'
import {
  acStrip, buildMonth, dayKey, dayStart, daysInMonth, firstWeekday, fleetIn, levelFor, monthTotals, placeOptions, repeatAcs, shiftMonth, tagFor, worstPlaces,
  type CalAc, type CalTicket,
} from '@/lib/reporting/executive/ac-calendar'

const at = (day: string, time = '10:00') => Date.parse(`${day}T${time}:00+05:30`)
const ac = (store: string, no: string, o: Partial<CalAc> = {}): CalAc => ({
  kind: 'ac',  key: `${store}|${no}`, store, storeName: `Store ${store}`, no, serial: `SER-${store}-${no}`, label: `AC ${no} Voltas 1.5 T`, region: 'R1', cluster: 'C1', state: 'JH', city: 'Pakur', ...o,
})
let n = 0
const tk = (store: string, acNo: string, created: number, resolved: number | null, o: Partial<CalTicket> = {}): CalTicket => ({
  kind: 'ac', id: `t${++n}`, no: `CKSD-${n}`, ac: `${store}|${acNo}`, acNo, serial: '', store, storeName: `Store ${store}`, region: 'R1', cluster: 'C1', state: 'JH', created, resolved, fixedBy: 'Voltas', status: resolved ? 'resolved' : 'in_progress', ...o,
})

describe('days in India time', () => {
  it('a ticket at 11:30 pm IST belongs to that IST day, not the next UTC day', () => {
    expect(dayKey(at('2026-10-05', '23:30'))).toBe('2026-10-05')
    expect(dayKey(at('2026-10-06', '00:10'))).toBe('2026-10-06')
    expect(dayStart('2026-10-05')).toBe(Date.parse('2026-10-04T18:30:00Z'))
  })
  it('month helpers', () => {
    expect(daysInMonth('2026-02')).toBe(28); expect(daysInMonth('2026-10')).toBe(31)
    expect(firstWeekday('2026-10')).toBe(3)   // 1 Oct 2026 is a Thursday (Mon = 0)
    expect(shiftMonth('2026-12', 1)).toBe('2027-01'); expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})

describe('the colour of a day', () => {
  it('green 0, light green up to 10%, yellow above 10%, red above 30%', () => {
    expect(levelFor(0, 7)).toBe('none')
    expect(levelFor(1, 20)).toBe('low')       // 5%
    expect(levelFor(2, 20)).toBe('low')       // exactly 10% is not above 10%
    expect(levelFor(1, 7)).toBe('medium')     // 14%
    expect(levelFor(3, 10)).toBe('medium')    // exactly 30% is not above 30%
    expect(levelFor(2, 7)).toBe('medium')     // 28.6%
    expect(levelFor(3, 7)).toBe('high')       // 42.9%
    expect(levelFor(5, 0)).toBe('high')       // faulty ACs but no AC total known
  })
})

describe('one month of a place', () => {
  const now = at('2026-10-10', '12:00')
  const fleet = [ac('A', '1'), ac('A', '2'), ac('A', '3'), ac('A', '4'), ac('A', '5'), ac('A', '6'), ac('A', '7')]
  const tickets = [
    tk('A', '2', at('2026-10-03'), at('2026-10-05', '15:00')),   // down on 3, 4, 5(until 3 pm: not at the end of day 5)
    tk('A', '2', at('2026-10-08'), null),                          // down from 8, still
    tk('A', '5', at('2026-10-08', '09:00'), at('2026-10-09')),     // down 8, fixed on the 9th
    tk('B', '1', at('2026-10-04'), null, { store: 'B', storeName: 'Store B', region: 'R2' }),
  ]
  const days = buildMonth('2026-10', tickets, 7, 'store', 'A', now)

  it('counts raised, resolved and faulty ACs at the end of each day', () => {
    const d = (n: number) => days[n - 1]
    expect(d(2)).toMatchObject({ raised: 0, resolved: 0, down: 0, level: 'none' })
    expect(d(3)).toMatchObject({ raised: 1, down: 1, level: 'medium' })     // 1 of 7 = 14%
    expect(d(4).down).toBe(1)
    expect(d(5)).toMatchObject({ resolved: 1, down: 0, level: 'none' })     // fixed during the 5th
    expect(d(8)).toMatchObject({ raised: 2, down: 2, level: 'medium' })     // 2 of 7 = 28.6%
    expect(d(9)).toMatchObject({ resolved: 1, down: 1 })
    expect(d(10).today).toBe(true)
  })
  it('days after today are grey and carry no numbers; another store\'s tickets do not count', () => {
    expect(days[10]).toMatchObject({ day: 11, future: true, level: 'future', raised: 0, down: 0 })
    expect(days.filter((d) => d.future)).toHaveLength(21)
    expect(days[3].openIds).not.toContain(tickets[3].id)
  })
  it('two tickets on the same AC are one faulty AC', () => {
    const two = [tk('A', '1', at('2026-10-02'), null), tk('A', '1', at('2026-10-03'), null)]
    expect(buildMonth('2026-10', two, 7, 'store', 'A', now)[4].down).toBe(1)
  })
  it('a region view counts all its stores; the whole company view counts everything', () => {
    expect(buildMonth('2026-10', tickets, 14, 'region', 'R2', now)[4].down).toBe(1)
    expect(buildMonth('2026-10', tickets, 14, 'all', '', now)[7].down).toBe(3)
  })
  it('month totals', () => {
    expect(monthTotals(days)).toEqual({ raised: 4 - 1, resolved: 2, downToday: 1 })
  })
})

describe('ACs that fail again and again', () => {
  const now = at('2026-10-23', '12:00')
  const fleet = [ac('A', '1'), ac('A', '2'), ac('A', '3')]
  const tickets = [
    tk('A', '2', at('2026-07-20'), at('2026-07-21')),              // outside the 90 days
    tk('A', '2', at('2026-09-01'), at('2026-09-02'), { fixedBy: 'Blue Star' }),
    tk('A', '2', at('2026-09-10'), at('2026-09-11')),              // came back 8 days after the fix
    tk('A', '2', at('2026-10-01'), at('2026-10-03'), { fixedBy: 'Voltas' }),   // came back 20 days after
    tk('A', '2', at('2026-10-20'), null),                          // 17 days after: came back; still open
    tk('A', '3', at('2026-10-05'), at('2026-10-06')),
    tk('A', '3', at('2026-10-15'), at('2026-10-16')),
    tk('A', '1', at('2026-10-12'), at('2026-10-13')),
    tk('A', '1', at('2026-10-12', '08:00'), null, { ac: '', acNo: '' }),   // does not say which AC: never in the repeat list
  ]
  const r = repeatAcs(tickets, fleet, 'store', 'A', now)
  it('ranks by tickets in the last 90 days with the tags', () => {
    expect(r.map((x) => [x.key, x.count, x.tag])).toEqual([['A|2', 4, 'repeat'], ['A|3', 2, 'watch'], ['A|1', 1, 'ok']])
    expect(tagFor(3)).toBe('watch'); expect(tagFor(4)).toBe('repeat'); expect(tagFor(1)).toBe('ok')
  })
  it('counts faults that came back within 30 days of the last fix, and says who fixed it last', () => {
    const two = r.find((x) => x.key === 'A|2')!
    expect(two.cameBack).toBe(3)
    expect(two.lastFixedBy).toBe('Voltas')
    expect(two.stillOpen).toBe(true)
    expect(two.label).toBe('AC 2 Voltas 1.5 T')
    expect(two.days).toEqual(['2026-09-01', '2026-09-10', '2026-10-01', '2026-10-20'])
  })
  it('a ticket older than 30 days after the previous fix is not a come-back', () => {
    const old = repeatAcs([tk('A', '3', at('2026-08-01'), at('2026-08-02')), tk('A', '3', at('2026-10-15'), null)], fleet, 'store', 'A', now)
    expect(old[0].cameBack).toBe(0)
  })
  it('the small boxes per AC of a store, including ACs with no ticket', () => {
    expect(acStrip(fleet, r, 'A').map((s) => [s.label, s.count, s.tag])).toEqual([['AC 1', 1, 'ok'], ['AC 2', 4, 'repeat'], ['AC 3', 2, 'watch']])
  })
})

describe('places', () => {
  const fleet = [ac('A', '1'), ac('A', '2'), ac('B', '1', { region: 'R2', cluster: 'C2', state: 'DL' }), ac('B', '2', { region: 'R2', cluster: 'C2', state: 'DL' })]
  it('lists the places of a kind with their AC counts, A to Z', () => {
    expect(placeOptions('state', fleet).map((p) => [p.key, p.acs])).toEqual([['DL', 2], ['JH', 2]])
    expect(placeOptions('store', fleet)[0].label).toBe('Store A (A)')
    expect(fleetIn(fleet, 'region', 'R2')).toHaveLength(2); expect(fleetIn(fleet, 'all', '')).toHaveLength(4)
  })
  it('ranks places by the share of their ACs that are faulty now', () => {
    const now = at('2026-10-23')
    const tickets = [tk('A', '1', at('2026-10-20'), null), tk('B', '1', at('2026-10-20'), null, { region: 'R2', cluster: 'C2', state: 'DL' }), tk('B', '2', at('2026-10-21'), null, { region: 'R2', cluster: 'C2', state: 'DL' }), tk('A', '2', at('2026-10-01'), at('2026-10-02'))]
    expect(worstPlaces('store', tickets, fleet, now).map((p) => [p.key, p.down, p.acs, p.pct])).toEqual([['B', 2, 2, 100], ['A', 1, 2, 50]])
  })
})
