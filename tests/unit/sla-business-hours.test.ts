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

function mockSupabaseWith(bizHours: BizHourRow[], holidays: HolidayRow[] = []) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      from: (table: string) => ({
        select: () => ({
          order: async () => ({ data: table === 'business_hours' ? bizHours : [] }),
          then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: table === 'holidays' ? holidays : [] }),
        }),
      }),
    }),
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
