// The ticket-volume calendar: open at the end of an India day, the colour against the slice's own usual level, the break-down lists, "same issue again", and the title.
import { describe, it, expect } from 'vitest'
import { dayStart } from '@/lib/reporting/executive/ac-calendar'
import {
  breakdown, buildVolumeMonth, calendarTitle, inVolPlace, openAt, sameIssueAgain, topValues, volPlaceOptions, volumeLevel, volumeLimits,
} from '@/lib/reporting/executive/issue-calendar'
import type { ExecTicket } from '@/lib/reporting/executive/engine'

const at = (day: string, time = '10:00') => Date.parse(`${day}T${time}:00+05:30`)
let n = 0
const tk = (created: number, resolved: number | null, o: Partial<ExecTicket> = {}): ExecTicket => ({
  id: `v${++n}`, no: `CKSD-${n}`, subject: 's', group: 'IT Group', tech: 'Asha', cat: 'GENISYS SUPPORT', sub: 'Billing screen', svc: 'IT SUPPORT', store: 'ALC', state: 'UP', cluster: 'UP5', region: 'R5',
  status: resolved ? 'resolved' : 'in_progress', created, resolved, ...o,
} as ExecTicket)

describe('open at the end of a day', () => {
  it('raised before the day ends and not resolved by then', () => {
    const t = tk(at('2026-10-05', '09:00'), at('2026-10-07', '12:00'))
    const end = (d: string) => dayStart(d) + 86_400_000
    expect(openAt(t, end('2026-10-04'))).toBe(false)
    expect(openAt(t, end('2026-10-05'))).toBe(true)
    expect(openAt(t, end('2026-10-06'))).toBe(true)
    expect(openAt(t, end('2026-10-07'))).toBe(false)
  })
})

describe('the colour against the slice\'s own usual level', () => {
  it('green nothing, light up to usual, yellow above usual, red above the busiest-15% level', () => {
    const lim = { usual: 5, busy: 9 }
    expect(volumeLevel(0, lim)).toBe('none'); expect(volumeLevel(5, lim)).toBe('low'); expect(volumeLevel(6, lim)).toBe('medium'); expect(volumeLevel(9, lim)).toBe('medium'); expect(volumeLevel(10, lim)).toBe('high')
  })
  it('works out the usual level from the last 90 days: a busy group and a tiny group both get a spread', () => {
    const now = at('2026-10-23', '12:00')
    const busy = Array.from({ length: 200 }, (_, i) => tk(now - (i % 80) * 86_400_000 - 3_600_000, now - (i % 80) * 86_400_000 + (1 + (i % 6)) * 86_400_000))
    const l = volumeLimits(busy, now)
    expect(l.usual).toBeGreaterThan(3); expect(l.busy).toBeGreaterThan(l.usual)
    const tiny = [tk(now - 5 * 86_400_000, now - 3 * 86_400_000), tk(now - 2 * 86_400_000, null)]
    const t = volumeLimits(tiny, now)
    expect(t.usual).toBe(1); expect(t.busy).toBe(2)
    expect(volumeLimits([], now)).toEqual({ usual: 1, busy: 2 })
  })
})

describe('one month', () => {
  const now = at('2026-10-10', '12:00')
  const tickets = [
    tk(at('2026-10-03'), at('2026-10-05', '15:00')), tk(at('2026-10-08'), null), tk(at('2026-10-08', '09:00'), at('2026-10-09')),
    tk(at('2026-10-04'), null, { status: 'cancelled' }),   // cancelled: never counted
  ]
  const days = buildVolumeMonth('2026-10', tickets, now, { usual: 1, busy: 2 })
  it('counts open, raised and fixed per day; future days are grey with no numbers', () => {
    expect(days[2]).toMatchObject({ raised: 1, open: 1, level: 'low' })
    expect(days[4]).toMatchObject({ resolved: 1, open: 0, level: 'none' })
    expect(days[7]).toMatchObject({ raised: 2, open: 2, level: 'medium' })
    expect(days[3].open).toBe(1)   // the cancelled ticket of the 4th is not counted
    expect(days[9].today).toBe(true)
    expect(days[10]).toMatchObject({ future: true, level: 'future', open: 0, raised: 0 })
  })
})

describe('places and lists', () => {
  const now = at('2026-10-23')
  const list = [
    tk(at('2026-10-20'), null, { store: 'ALC', tech: 'Asha', cluster: 'UP5' }), tk(at('2026-10-21'), null, { store: 'MAR', tech: 'Ravi', cluster: 'C1', state: 'DL' }), tk(at('2026-10-01'), at('2026-10-02'), { store: 'ALC', tech: 'Asha' }),
  ]
  it('place options and membership', () => {
    expect(volPlaceOptions('state', list).map((o) => [o.key, o.count])).toEqual([['DL', 1], ['UP', 2]])
    expect(inVolPlace('store', 'ALC', list[0])).toBe(true); expect(inVolPlace('store', 'ALC', list[1])).toBe(false); expect(inVolPlace('all', '', list[1])).toBe(true)
  })
  it('breaks the slice down by technician, open first', () => {
    const rows = breakdown(list, 'tech', '2026-10', now)
    expect(rows[0]).toEqual({ key: 'Asha', open: 1, raised: 2, fixed: 1 })
    expect(rows[1]).toEqual({ key: 'Ravi', open: 1, raised: 1, fixed: 0 })
  })
  it('the most common categories and sub categories of the last 90 days', () => {
    const mixed = [tk(at('2026-10-20'), null, { cat: 'A', sub: 'x' }), tk(at('2026-10-20'), null, { cat: 'A', sub: '(No sub category)' }), tk(at('2026-10-20'), null, { cat: 'B', sub: 'y' })]
    expect(topValues(mixed, 'cat', now)).toEqual([{ key: 'A', count: 2 }, { key: 'B', count: 1 }])
    expect(topValues(mixed, 'sub', now).map((x) => x.key).sort()).toEqual(['x', 'y'])
  })
})

describe('the same issue again', () => {
  const now = at('2026-10-23', '12:00')
  const again = [
    tk(at('2026-09-01'), at('2026-09-02'), { store: 'ALC', sub: 'Billing screen' }),
    tk(at('2026-09-10'), at('2026-09-11'), { store: 'ALC', sub: 'Billing screen' }),
    tk(at('2026-10-01'), at('2026-10-02'), { store: 'ALC', sub: 'Billing screen' }),
    tk(at('2026-10-15'), null, { store: 'ALC', sub: 'Billing screen' }),
    tk(at('2026-10-05'), at('2026-10-06'), { store: 'MAR', sub: 'Printer' }),
    tk(at('2026-10-06'), at('2026-10-07'), { store: 'MAR', sub: 'Login' }),   // a different issue: not a repeat
  ]
  const r = sameIssueAgain(again, now)
  it('lists a store that raised the same issue again, with the tag and the come-backs', () => {
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ store: 'ALC', issue: 'Billing screen', count: 4, tag: 'repeat', stillOpen: true })
    expect(r[0].cameBack).toBe(3)
  })
  it('uses the category when there is no sub category', () => {
    const noSub = [tk(at('2026-10-01'), at('2026-10-02'), { sub: '(No sub category)', cat: 'FAN' }), tk(at('2026-10-10'), null, { sub: '(No sub category)', cat: 'FAN' })]
    expect(sameIssueAgain(noSub, now)[0].issue).toBe('FAN')
  })
})

describe('the title', () => {
  it('is named after the group chosen at the top', () => {
    expect(calendarTitle(['IT Group'])).toBe('IT Ticket Calendar')
    expect(calendarTitle(['ADMIN GROUP'])).toBe('ADMIN Ticket Calendar')
    expect(calendarTitle(['PO  GM GROUP'])).toBe('PO GM Ticket Calendar')
    expect(calendarTitle(['BD Group'])).toBe('BD Ticket Calendar')
    expect(calendarTitle([])).toBe('Ticket Calendar')
    expect(calendarTitle(['IT Group', 'HR GROUP'])).toBe('Ticket Calendar (2 groups)')
  })
})
