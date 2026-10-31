import { describe, it, expect } from 'vitest'
import { latestSlot, nextSlot, isReportDue, describeSchedule, RETRY_WINDOW_MS } from '@/lib/reports/schedule'

// India time is UTC+5:30, so 07:00 IST is 01:30 UTC.
const ist = (iso: string) => new Date(`${iso}+05:30`)

describe('when a scheduled report goes out', () => {
  it('daily: 07:00 India time every day; before 07:00 the latest slot is yesterday\'s', () => {
    expect(latestSlot('daily', ist('2026-10-30T09:15:00')).toISOString()).toBe(ist('2026-10-30T07:00:00').toISOString())
    expect(latestSlot('daily', ist('2026-10-30T06:59:59')).toISOString()).toBe(ist('2026-10-29T07:00:00').toISOString())
    expect(latestSlot('daily', ist('2026-10-30T07:00:00')).toISOString()).toBe(ist('2026-10-30T07:00:00').toISOString())
  })

  it('weekly: Monday 07:00 India time (30 Oct 2026 is a Friday)', () => {
    expect(latestSlot('weekly', ist('2026-10-30T09:00:00')).toISOString()).toBe(ist('2026-10-26T07:00:00').toISOString())
    expect(latestSlot('weekly', ist('2026-10-26T06:00:00')).toISOString()).toBe(ist('2026-10-19T07:00:00').toISOString())   // Monday before 07:00: the week before
    expect(latestSlot('weekly', ist('2026-10-26T07:00:01')).toISOString()).toBe(ist('2026-10-26T07:00:00').toISOString())
    expect(latestSlot('weekly', ist('2026-11-01T23:00:00')).toISOString()).toBe(ist('2026-10-26T07:00:00').toISOString())   // Sunday night
  })

  it('monthly: the 1st at 07:00 India time, also across the year end', () => {
    expect(latestSlot('monthly', ist('2026-10-30T09:00:00')).toISOString()).toBe(ist('2026-10-01T07:00:00').toISOString())
    expect(latestSlot('monthly', ist('2026-11-01T06:00:00')).toISOString()).toBe(ist('2026-10-01T07:00:00').toISOString())
    expect(latestSlot('monthly', ist('2027-01-01T08:00:00')).toISOString()).toBe(ist('2027-01-01T07:00:00').toISOString())
    expect(latestSlot('monthly', ist('2027-01-01T05:00:00')).toISOString()).toBe(ist('2026-12-01T07:00:00').toISOString())
  })

  it('uses the India day, not the server\'s time zone (a moment late in the evening UTC is already the next India day)', () => {
    // 2026-10-30 20:00 UTC = 2026-10-31 01:30 IST -> the India day is the 31st and 07:00 of it has not come yet
    expect(latestSlot('daily', new Date('2026-10-30T20:00:00Z')).toISOString()).toBe(ist('2026-10-30T07:00:00').toISOString())
    // 2026-10-30 02:00 UTC = 07:30 IST -> today's slot has passed
    expect(latestSlot('daily', new Date('2026-10-30T02:00:00Z')).toISOString()).toBe(ist('2026-10-30T07:00:00').toISOString())
  })

  it('the next slot is one period after the latest', () => {
    expect(nextSlot('daily', ist('2026-10-30T09:00:00')).toISOString()).toBe(ist('2026-10-31T07:00:00').toISOString())
    expect(nextSlot('weekly', ist('2026-10-30T09:00:00')).toISOString()).toBe(ist('2026-11-02T07:00:00').toISOString())
    expect(nextSlot('monthly', ist('2026-10-30T09:00:00')).toISOString()).toBe(ist('2026-11-01T07:00:00').toISOString())
    expect(nextSlot('monthly', ist('2026-12-15T09:00:00')).toISOString()).toBe(ist('2027-01-01T07:00:00').toISOString())
  })

  it('is due when its latest slot is later than the last send; never when switched off; a new report waits for the next slot', () => {
    const now = ist('2026-10-30T09:00:00')
    const base = { is_active: true, frequency: 'daily' as const, created_at: '2026-10-01T00:00:00Z', last_sent_at: null as string | null }
    expect(isReportDue(base, now)).toBe(true)                                                                  // never sent
    expect(isReportDue({ ...base, last_sent_at: ist('2026-10-29T07:00:05').toISOString() }, now)).toBe(true)   // sent yesterday
    expect(isReportDue({ ...base, last_sent_at: ist('2026-10-30T07:00:05').toISOString() }, now)).toBe(false)  // already sent today
    expect(isReportDue({ ...base, is_active: false }, now)).toBe(false)
    expect(isReportDue({ ...base, created_at: ist('2026-10-30T08:00:00').toISOString() }, now)).toBe(false)    // made after today's slot
    expect(isReportDue({ ...base, created_at: ist('2026-10-30T06:00:00').toISOString() }, now)).toBe(true)     // made before it
  })

  it('has a plain description for the screen and a 6 hour retry window', () => {
    expect(describeSchedule('daily')).toBe('every day at 07:00 India time')
    expect(describeSchedule('weekly')).toBe('every Monday at 07:00 India time')
    expect(describeSchedule('monthly')).toBe('on the 1st of every month at 07:00 India time')
    expect(RETRY_WINDOW_MS).toBe(6 * 3_600_000)
  })
})
