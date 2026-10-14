import { describe, it, expect } from 'vitest'
import { istStamp, istTime } from '@/lib/reporting/ist'

// A ticket created at 03:00 on 3 October India time is 21:30 on 2 October UTC. The Report Builder shows the first 10 characters of the timestamp as the date,
// so it must be given the India time, or the ticket is listed on 2 October while its time column says 03:00.
describe('Report Builder dates are India dates', () => {
  it('a ticket created at 03:00 IST on 3 Oct is on 3 Oct, not 2 Oct', () => {
    const fromDatabase = '2026-10-02T21:30:00+00:00'
    expect(fromDatabase.slice(0, 10)).toBe('2026-10-02') // what the report used to show
    expect(istStamp(fromDatabase).slice(0, 10)).toBe('2026-10-03')
    expect(istTime(fromDatabase)).toBe('03:00')
  })
  it('the date and the time always belong together, around midnight and 05:30', () => {
    const cases: [string, string, string][] = [
      ['2026-10-02T18:29:59+00:00', '2026-10-02', '23:59'],
      ['2026-10-02T18:30:00+00:00', '2026-10-03', '00:00'],
      ['2026-10-02T18:35:00+00:00', '2026-10-03', '00:05'],
      ['2026-10-03T05:29:00+00:00', '2026-10-03', '10:59'],
      ['2026-12-31T20:00:00.123456+00:00', '2027-01-01', '01:30'],
    ]
    for (const [utc, date, time] of cases) {
      expect(istStamp(utc).slice(0, 10), utc).toBe(date)
      expect(istTime(utc), utc).toBe(time)
    }
  })
  it('a timestamp that already carries the India offset keeps its day', () => {
    expect(istStamp('2026-09-30T15:39:17.016734+05:30').slice(0, 10)).toBe('2026-09-30')
    expect(istTime('2026-09-30T15:39:17.016734+05:30')).toBe('15:39')
  })
  it('leaves plain dates, text and nothing alone', () => {
    expect(istStamp('2026-10-03')).toBe('2026-10-03')
    expect(istStamp('not a date at all')).toBe('not a date at all')
    expect(istTime(null)).toBeNull()
    expect(istTime('nope')).toBeNull()
  })
})
