// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { formatDateTime, formatRelativeTime } from '@/lib/utils'
import { SLABadge } from '@/components/requests/SLABadge'
import { istStamp } from '@/lib/reporting/ist'

afterEach(() => cleanup())

// The server writes these dates in its own zone and the browser in the PC's zone. A PC set to another zone made the two texts differ, which React reports as error #418
// (the System Log recorded it for several store users on the request lists). Writing them in India time makes every PC and the server agree.
describe('dates the pages show are India time, whatever time zone the PC is set to', () => {
  it('formatDateTime', () => {
    expect(formatDateTime('2026-10-14T23:30:00Z')).toBe('Oct 15, 2026, 05:00')
  })
  it('an old date in a list: 20:00 UTC on 1 Jan is already 2 Jan in India', () => {
    expect(formatRelativeTime('2020-01-01T20:00:00Z')).toBe('Jan 2')
  })
  it('the SLA badge', () => {
    const { container } = render(<SLABadge resolutionDueAt="2099-10-14T23:30:00Z" responseDueAt={null} status="in_progress" />)
    expect(container.textContent).toBe('Oct 15, 05:00')
  })
})

describe('the exported System Log time reads in India time', () => {
  it('a time the database wrote in the US Pacific offset', () => {
    // 2026-10-15T00:49:47-07:00 (what the file used to say) is 13:19 in India
    expect(istStamp('2026-10-15T00:49:47.902-07:00')).toBe('2026-10-15T13:19:47.902+05:30')
  })
})
