import { describe, it, expect } from 'vitest'
import { momentOf, countSince } from '@/lib/analytics/moment'

// The Req. Inflow "Last 24 Hours" card showed 27 while 28 tickets were created: the database sends "...-07:00" times and the card compared them as text.
describe('timestamps are compared as moments, not as text', () => {
  const boundary = '2026-10-12T18:30:00.000Z'               // 00:00 on 13 Oct, India time
  const ticket = '2026-10-12T11:45:52.273017-07:00'          // CKSD-000243: 18:45 UTC = 00:15 on 13 Oct, India time
  it('what went wrong: as text the ticket is before the boundary, as moments it is after it', () => {
    expect(ticket >= boundary).toBe(false)
    expect(momentOf(ticket) >= momentOf(boundary)).toBe(true)
  })
  it('counts every ticket at or after the boundary whatever offset its timestamp is written with', () => {
    const stamps = [
      ticket,                                  // -07:00, after
      '2026-10-13T01:06:05.4693-07:00',        // after
      '2026-10-12T18:30:00.000000+00:00',      // exactly on the boundary: counts
      '2026-10-13T00:15:00+05:30',             // India offset, after
      '2026-10-12T10:00:55.650228-07:00',      // CKSD-000242: 17:00 UTC, before
      '2026-10-12T23:59:00+05:30',             // 18:29 UTC, before
    ]
    expect(countSince(stamps, momentOf(boundary))).toBe(4)
  })
})
