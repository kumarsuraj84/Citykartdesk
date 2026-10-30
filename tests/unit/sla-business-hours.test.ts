/**
 * Consolidated remediation — item 7: SLA business-hours all-inactive
 * misconfiguration.
 *
 * Root cause: computeSLADeadline() walked the business-hours calendar
 * day-by-day up to a 5-year safety bound (MAX_DAYS); if no day in that
 * entire span had a usable window (every business_hours row inactive, no
 * rows configured at all, or every row's start/end times described a
 * zero/negative-width window), the loop fell through to `return cursor` —
 * the cursor after walking the full 5 years — silently turning a
 * configuration failure into a plausible-but-wrong "now + ~5 years"
 * deadline with no error, no warning, nothing surfaced anywhere.
 *
 * Fix: computeSLADeadline() now returns `Date | null`, returning null (and
 * logging + alerting) when no usable window is found — folding into the
 * "no SLA deadline" null state lib/sla/resolve.ts already supports.
 *
 * getSLACalendar() is wrapped in React.cache(), which memoizes per module
 * instance — each test below uses vi.resetModules() + a fresh dynamic
 * import so different calendar fixtures don't bleed across test cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const alertOperatorMock = vi.fn().mockResolvedValue({ sent: true })
vi.mock('@/lib/observability/alert', () => ({ alertOperator: alertOperatorMock }))

type BizHourRow = { day_of_week: number; start_time: string; end_time: string; is_active: boolean }
type HolidayRow = { date: string; is_recurring: boolean }

// B-01: the calendar is read with the server's own (admin) client, so the signed-in user's client is made to fail loudly if it is ever used again
function mockSupabaseWith(bizHours: BizHourRow[], holidays: HolidayRow[] = []) {
  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
      from: (table: string) => ({
        select: () => ({
          order: async () => ({ data: table === 'business_hours' ? bizHours : [] }),
          then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: table === 'holidays' ? holidays : [] }),
        }),
      }),
    }),
  }))
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => { throw new Error('the SLA calendar must not be read with the cookie-bound client') },
  }))
}

async function freshComputeSLADeadline() {
  vi.resetModules()
  const mod = await import('@/lib/sla/business-hours')
  return mod.computeSLADeadline
}

// A normal Mon-Fri 09:00-17:00 schedule, all active, used by several cases.
const NORMAL_WEEK: BizHourRow[] = [
  { day_of_week: 0, start_time: '09:00', end_time: '17:00', is_active: false }, // Sunday
  { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_active: true },
  { day_of_week: 2, start_time: '09:00', end_time: '17:00', is_active: true },
  { day_of_week: 3, start_time: '09:00', end_time: '17:00', is_active: true },
  { day_of_week: 4, start_time: '09:00', end_time: '17:00', is_active: true },
  { day_of_week: 5, start_time: '09:00', end_time: '17:00', is_active: true },
  { day_of_week: 6, start_time: '09:00', end_time: '17:00', is_active: false }, // Saturday
]

beforeEach(() => {
  alertOperatorMock.mockClear()
})
afterEach(() => {
  vi.doUnmock('@/lib/supabase/server')
  vi.doUnmock('@/lib/supabase/admin')
})

describe('computeSLADeadline() — SLA business-hours misconfiguration guard', () => {
  it('normal schedule: a same-day deadline within business hours lands correctly', async () => {
    mockSupabaseWith(NORMAL_WEEK)
    const computeSLADeadline = await freshComputeSLADeadline()
    // Monday 2026-09-14 10:00 local + 120 minutes → 12:00 same day.
    const start = new Date(2026, 8, 14, 10, 0, 0)
    const deadline = await computeSLADeadline(start, 120)
    expect(deadline).not.toBeNull()
    expect(deadline!.getHours()).toBe(12)
    expect(deadline!.getDate()).toBe(14)
  })

  it('weekends are skipped: a Friday-afternoon deadline that overflows the day resumes Monday morning', async () => {
    mockSupabaseWith(NORMAL_WEEK)
    const computeSLADeadline = await freshComputeSLADeadline()
    // Friday 2026-09-11 16:00 + 120 minutes: only 60 min left in Friday's
    // window (16:00-17:00), remaining 60 min rolls to Monday 09:00-10:00.
    const start = new Date(2026, 8, 11, 16, 0, 0)
    const deadline = await computeSLADeadline(start, 120)
    expect(deadline).not.toBeNull()
    expect(deadline!.getDay()).toBe(1) // Monday
    expect(deadline!.getHours()).toBe(10)
    expect(deadline!.getMinutes()).toBe(0)
  })

  it('holidays are skipped like an inactive day', async () => {
    // Tuesday 2026-09-15 is a one-off holiday.
    mockSupabaseWith(NORMAL_WEEK, [{ date: '2026-09-15', is_recurring: false }])
    const computeSLADeadline = await freshComputeSLADeadline()
    // Monday 2026-09-14 16:30 + 90 minutes: 30 min left Monday, Tuesday is a
    // holiday (skipped), so the remaining 60 min lands Wednesday 09:00-10:00.
    const start = new Date(2026, 8, 14, 16, 30, 0)
    const deadline = await computeSLADeadline(start, 90)
    expect(deadline).not.toBeNull()
    expect(deadline!.getDate()).toBe(16) // Wednesday
    expect(deadline!.getHours()).toBe(10)
  })

  it('a recurring holiday is skipped in a later year too, matched by month/day regardless of the year it was created against', async () => {
    // DESK-HOLIDAY-001: New Year's Day, created against 2026-01-01, must
    // still apply in 2027 — 2027-01-01 is a Friday (an ordinary business
    // day per NORMAL_WEEK), so this only passes if the recurring month/day
    // match actually fires rather than falling back to the exact-date check.
    mockSupabaseWith(NORMAL_WEEK, [{ date: '2026-01-01', is_recurring: true }])
    const computeSLADeadline = await freshComputeSLADeadline()
    // Thursday 2026-12-31 16:30 + 90 minutes: 30 min left Thursday, Friday
    // 2027-01-01 is the recurring holiday (skipped), Sat/Sun already
    // inactive, so the remaining 60 min lands Monday 2027-01-04 09:00-10:00.
    const start = new Date(2026, 11, 31, 16, 30, 0)
    const deadline = await computeSLADeadline(start, 90)
    expect(deadline).not.toBeNull()
    expect(deadline!.getFullYear()).toBe(2027)
    expect(deadline!.getMonth()).toBe(0) // January
    expect(deadline!.getDate()).toBe(4)
    expect(deadline!.getHours()).toBe(10)
  })

  it('all business-hours rows inactive: returns null, logs a structured warning, and alerts the operator — not a 5-years-out date', async () => {
    const allInactive = NORMAL_WEEK.map((r) => ({ ...r, is_active: false }))
    mockSupabaseWith(allInactive)
    const computeSLADeadline = await freshComputeSLADeadline()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const start = new Date(2026, 8, 14, 10, 0, 0)
    const deadline = await computeSLADeadline(start, 60)

    expect(deadline).toBeNull()
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string)
    expect(logged.event).toBe('sla.business_hours.no_usable_window')
    expect(alertOperatorMock).toHaveBeenCalledTimes(1)
    expect(alertOperatorMock.mock.calls[0][0].key).toBe('sla.business_hours.no_usable_window')

    errorSpy.mockRestore()
  })

  it('no business-hours rows configured at all: returns null (same fallback path as all-inactive)', async () => {
    mockSupabaseWith([])
    const computeSLADeadline = await freshComputeSLADeadline()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const deadline = await computeSLADeadline(new Date(2026, 8, 14, 10, 0, 0), 60)
    expect(deadline).toBeNull()
  })

  it('exactly one active day: a deadline that fits within it still resolves; one that overflows wraps to the following week\'s same day', async () => {
    const onlyWednesday: BizHourRow[] = [
      { day_of_week: 3, start_time: '09:00', end_time: '17:00', is_active: true },
    ]
    mockSupabaseWith(onlyWednesday)
    const computeSLADeadline = await freshComputeSLADeadline()

    // Wednesday 2026-09-16 09:00 + 60 min fits same day.
    const fits = await computeSLADeadline(new Date(2026, 8, 16, 9, 0, 0), 60)
    expect(fits).not.toBeNull()
    expect(fits!.getHours()).toBe(10)

    // Wednesday 2026-09-16 09:00 + (8h window + 60 extra min) overflows to
    // the following Wednesday.
    const overflow = await computeSLADeadline(new Date(2026, 8, 16, 9, 0, 0), 8 * 60 + 60)
    expect(overflow).not.toBeNull()
    expect(overflow!.getDay()).toBe(3)
    expect(overflow!.getDate()).toBe(23) // next Wednesday
  })

  it('an invalid (zero/negative-width) window on every day behaves identically to all-inactive: returns null', async () => {
    // start_time === end_time on every day — zero capacity every single day,
    // the same failure mode as "all inactive" but caused by bad window data
    // instead of the is_active flag.
    const zeroWidth: BizHourRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      day_of_week: d, start_time: '09:00', end_time: '09:00', is_active: true,
    }))
    mockSupabaseWith(zeroWidth)
    const computeSLADeadline = await freshComputeSLADeadline()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const deadline = await computeSLADeadline(new Date(2026, 8, 14, 10, 0, 0), 60)
    expect(deadline).toBeNull()
  })
})

describe('lib/sla/resolve.ts — resolveSlaDeadlines folds a null computeSLADeadline into its existing "no SLA" null state', () => {
  it('an all-inactive calendar produces null responseDueAt/resolutionDueAt rather than throwing or leaking a far-future date', async () => {
    const allInactive = NORMAL_WEEK.map((r) => ({ ...r, is_active: false }))
    mockSupabaseWith(allInactive)
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { resolveSlaDeadlines } = await import('@/lib/sla/resolve')

    const fakeSupabase = { from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }) }) }
    const result = await resolveSlaDeadlines(fakeSupabase as never, {
      serviceId: 'svc-1',
      priority: 'medium',
      servicePolicyConfig: { medium: { response_hours: 4, resolution_hours: 24 } } as never,
      from: new Date(2026, 8, 14, 10, 0, 0),
    })

    expect(result.responseDueAt).toBeNull()
    expect(result.resolutionDueAt).toBeNull()
  })
})

// F-28 / B-01 / F-13: all-day calendar, and the calendar read by a caller with no browser session
const ALL_DAY: BizHourRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: '00:00:00', end_time: '23:59:00', is_active: true }))

describe('F-28: a 00:00-23:59 calendar is a full day, so no minute is lost at midnight', () => {
  it('24 hours from 10:59:24 ends at 10:59 the next day (it used to end at 11:00)', async () => {
    mockSupabaseWith(ALL_DAY)
    const computeSLADeadline = await freshComputeSLADeadline()
    const d = await computeSLADeadline(new Date(2026, 8, 14, 10, 59, 24), 24 * 60)
    expect(d).not.toBeNull()
    expect([d!.getDate(), d!.getHours(), d!.getMinutes()]).toEqual([15, 10, 59])
  })

  it('48 hours from 10:00 ends at exactly 10:00 two days later (it used to end at 10:02)', async () => {
    mockSupabaseWith(ALL_DAY)
    const computeSLADeadline = await freshComputeSLADeadline()
    const d = await computeSLADeadline(new Date(2026, 8, 14, 10, 0, 0), 48 * 60)
    expect([d!.getDate(), d!.getHours(), d!.getMinutes()]).toEqual([16, 10, 0])
  })

  it('1 hour from 23:59:30 ends at 00:59 (it used to end at 01:00)', async () => {
    mockSupabaseWith(ALL_DAY)
    const computeSLADeadline = await freshComputeSLADeadline()
    const d = await computeSLADeadline(new Date(2026, 8, 14, 23, 59, 30), 60)
    expect([d!.getDate(), d!.getHours(), d!.getMinutes()]).toEqual([15, 0, 59])
  })

  it('a real office-hours calendar is not changed: 09:00-18:00, 2 hours from 17:00 ends the next morning at 10:00', async () => {
    mockSupabaseWith([0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: '09:00:00', end_time: '18:00:00', is_active: true })))
    const computeSLADeadline = await freshComputeSLADeadline()
    const d = await computeSLADeadline(new Date(2026, 8, 14, 17, 0, 0), 120)
    expect([d!.getDate(), d!.getHours(), d!.getMinutes()]).toEqual([15, 10, 0])
  })

  it('the elapsed business minutes of a whole 24 hours is 1440, not 1439', async () => {
    mockSupabaseWith(ALL_DAY)
    vi.resetModules()
    const { computeElapsedBusinessMinutes } = await import('@/lib/sla/business-hours')
    expect(await computeElapsedBusinessMinutes(new Date(2026, 8, 14, 10, 0, 0), new Date(2026, 8, 15, 10, 0, 0))).toBe(1440)
  })
})

describe('B-01: the calendar is read with the server key, so a caller with no browser session still gets a deadline', () => {
  it('computes a deadline although the cookie-bound client would throw', async () => {
    mockSupabaseWith(NORMAL_WEEK)
    const computeSLADeadline = await freshComputeSLADeadline()
    const d = await computeSLADeadline(new Date(2026, 8, 14, 10, 0, 0), 120)
    expect(d).not.toBeNull()
    expect(d!.getHours()).toBe(12)
  })
})

describe('F-13: a pause is credited in business time when the calendar has gaps, in plain time when it does not', () => {
  it('always-on calendar: the credit is the wall-clock gap, and the deadline moves by exactly that', async () => {
    mockSupabaseWith(ALL_DAY)
    vi.resetModules()
    const { pauseCreditMs, shiftDeadlineByCredit } = await import('@/lib/sla/business-hours')
    const start = new Date(2026, 8, 14, 20, 0, 0)
    const end = new Date(2026, 8, 15, 8, 0, 0)
    const credit = await pauseCreditMs(start, end)
    expect(credit).toBe(12 * 3_600_000)
    const due = new Date(2026, 8, 20, 12, 0, 37)
    expect((await shiftDeadlineByCredit(due, credit)).getTime()).toBe(due.getTime() + credit)
  })

  it('9-to-5 calendar: a night spent waiting on the user is NOT credited (only the working minutes inside the pause are)', async () => {
    mockSupabaseWith(NORMAL_WEEK)
    vi.resetModules()
    const { pauseCreditMs, shiftDeadlineByCredit } = await import('@/lib/sla/business-hours')
    // Monday 16:00 to Tuesday 10:00: one hour on Monday (16-17) and one on Tuesday (9-10) are working time
    const credit = await pauseCreditMs(new Date(2026, 8, 14, 16, 0, 0), new Date(2026, 8, 15, 10, 0, 0))
    expect(credit).toBe(2 * 3_600_000)
    // a deadline of Wednesday 10:00 moves by 2 working hours, to Wednesday 12:00 (not by 18 wall-clock hours)
    const moved = await shiftDeadlineByCredit(new Date(2026, 8, 16, 10, 0, 0), credit)
    expect([moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([16, 12, 0])
  })
})
