import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/observability/logger'
import { alertOperator } from '@/lib/observability/alert'

type DaySchedule = { start_time: string; end_time: string; is_active: boolean }
type Holiday = { date: string; is_recurring: boolean }

/**
 * Load the business-hours calendar once per request. business_hours/holidays change
 * rarely, so React.cache dedupes repeated reads within a single server request (e.g. when
 * more than one SLA deadline is computed in the same action).
 */
const getSLACalendar = cache(async (): Promise<{
  scheduleMap: Map<number, DaySchedule>
  holidays: Holiday[]
  /** True when either query itself failed (e.g. a transient connection
   *  error) rather than genuinely returning zero rows - see the distinct
   *  logging this drives in computeSLADeadline() below. Confirmed on Main
   *  under target-scale load testing: a burst of connection failures during
   *  this read produced an empty scheduleMap that was indistinguishable
   *  from "business_hours has 0 rows configured" even though the table was
   *  fully intact - misreporting a transient hiccup as a critical
   *  misconfiguration alert. */
  loadError: boolean
}> => {
  const supabase = await createClient()
  const [{ data: bizHours, error: bizHoursError }, { data: holidaysData, error: holidaysError }] = await Promise.all([
    supabase.from('business_hours').select('*').order('day_of_week'),
    supabase.from('holidays').select('*'),
  ])

  if (bizHoursError || holidaysError) {
    logger.error({
      event: 'sla.calendar_load_failed',
      message: 'Failed to load business_hours/holidays - treating as empty for this call only, not a real 0-row calendar',
      route: 'lib/sla/business-hours.ts#getSLACalendar',
      error: bizHoursError ?? holidaysError,
    })
  }

  const scheduleMap = new Map<number, DaySchedule>()
  for (const row of bizHours ?? []) {
    scheduleMap.set(row.day_of_week, {
      start_time: row.start_time,
      end_time: row.end_time,
      is_active: row.is_active,
    })
  }
  return { scheduleMap, holidays: (holidaysData ?? []) as Holiday[], loadError: Boolean(bizHoursError || holidaysError) }
})

function isHoliday(date: Date, holidays: Holiday[]): boolean {
  const month = date.getMonth() + 1
  const day = date.getDate()
  // Local calendar date, not toISOString()'s UTC one — every other date op
  // in this file (getHours/getMinutes/setHours, the recurring check just
  // below) is local-time, so a UTC string here could disagree with them by
  // a day whenever the process runs with a non-zero UTC offset (this app
  // deploys with TZ=Asia/Kolkata), honoring a non-recurring holiday a day
  // early or late relative to the recurring-holiday check in the same walk.
  const fullDate = `${date.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return holidays.some((h) => {
    if (h.is_recurring) {
      const [, hMonth, hDay] = h.date.split('-').map(Number)
      return hMonth === month && hDay === day
    }
    return h.date === fullDate
  })
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/**
 * Compute the SLA deadline `slaDurationMinutes` business-minutes after `startAt`, honoring
 * configured business hours and holidays.
 *
 * Walks the calendar day-by-day (O(days), not minute-by-minute), consuming each day's
 * available business window until the budget runs out, then lands on the exact minute
 * within the final day.
 *
 * Returns `null` if the configured calendar has no usable business-hour window at all
 * (every business_hours row inactive, no rows configured, or every row's start/end times
 * describe a zero/negative-width window) — see the loop's fallback below. Callers already
 * treat a null due-at as "no SLA deadline" (see lib/sla/resolve.ts, which nulls out
 * responseDueAt/resolutionDueAt when there's no applicable SLA tier at all), so this is a
 * real, already-supported business state — unlike the previous behavior, which walked the
 * calendar for the full 5-year safety bound and returned that far-future date as if it
 * were a legitimate deadline, turning a configuration failure into a plausible-looking but
 * completely wrong SLA.
 */
export async function computeSLADeadline(
  startAt: Date,
  slaDurationMinutes: number
): Promise<Date | null> {
  const { scheduleMap, holidays, loadError } = await getSLACalendar()

  let remaining = slaDurationMinutes
  const cursor = new Date(startAt)
  const MAX_DAYS = 366 * 5 // safety bound (~5 years of calendar days)

  for (let dayCount = 0; dayCount < MAX_DAYS; dayCount++) {
    const schedule = scheduleMap.get(cursor.getDay())

    if (schedule && schedule.is_active && !isHoliday(cursor, holidays)) {
      const startMin = timeToMinutes(schedule.start_time)
      const endMin = timeToMinutes(schedule.end_time)

      // On day 0 we start from the request time; later days start at midnight (0).
      const cursorMin = dayCount === 0 ? cursor.getHours() * 60 + cursor.getMinutes() : 0
      const windowStart = Math.max(cursorMin, startMin)

      if (windowStart < endMin) {
        const available = endMin - windowStart
        if (remaining <= available) {
          const targetMin = windowStart + remaining
          const deadline = new Date(cursor)
          deadline.setHours(Math.floor(targetMin / 60), targetMin % 60, 0, 0)
          return deadline
        }
        remaining -= available
      }
    }

    // Advance to the start of the next calendar day.
    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(0, 0, 0, 0)
  }

  // No business capacity found anywhere within the bound. Two genuinely
  // different situations land here, and conflating them previously misled
  // whoever reads the alert: either the calendar itself failed to load
  // (loadError - transient, e.g. a connection hiccup; the same table read
  // fine a moment before and after) or it loaded fine and is genuinely
  // empty/all-inactive/zero-width (a real configuration problem). Either
  // way "no deadline" (rather than "now + ~5 years") is still the only safe
  // return value, but a transient load failure must not page an operator
  // as a critical misconfiguration.
  logger.error({
    event: loadError ? 'sla.business_hours.load_failed_no_deadline' : 'sla.business_hours.no_usable_window',
    message: loadError
      ? 'SLA deadline could not be computed because business_hours/holidays failed to load (transient failure, not a real misconfiguration)'
      : 'SLA deadline could not be computed — the business-hours calendar has no usable window (all inactive, no rows configured, or every window is zero/negative width)',
    route: 'lib/sla/business-hours.ts#computeSLADeadline',
    errorCode: loadError ? 'sla_business_hours_load_failed' : 'sla_business_hours_misconfigured',
    context: { scheduleRowCount: scheduleMap.size, slaDurationMinutes },
  })
  await alertOperator({
    key: loadError ? 'sla.business_hours.load_failed' : 'sla.business_hours.no_usable_window',
    severity: loadError ? 'warning' : 'critical',
    title: loadError
      ? 'SLA deadline computation failed to load the business-hours calendar (transient)'
      : 'SLA deadlines cannot be computed — business-hours calendar has no usable window',
    detail: { scheduleRowCount: scheduleMap.size },
  })
  return null
}

/**
 * Inverse of computeSLADeadline: sums the business minutes that fall between two
 * timestamps, honoring the same business-hours/holiday calendar. Used by the
 * business-rules cron (app/api/business-rules/run) to compute "% of SLA time elapsed" against
 * actual working time instead of raw wall-clock time — a deadline that spans a weekend
 * or holiday shouldn't read as more "elapsed" than the working hours actually consumed.
 *
 * `endAt` may be after a request's deadline (mid-breach) or even past "now" is never
 * expected here, but the walk naturally keeps accumulating past the deadline too, so
 * elapsed/total can legitimately exceed 100% — that's what signals a breach.
 */
export async function computeElapsedBusinessMinutes(startAt: Date, endAt: Date): Promise<number> {
  if (endAt <= startAt) return 0
  const { scheduleMap, holidays } = await getSLACalendar()

  let total = 0
  const cursor = new Date(startAt)
  cursor.setHours(0, 0, 0, 0)
  const MAX_DAYS = 366 * 5 // safety bound (~5 years of calendar days), mirrors computeSLADeadline

  for (let dayCount = 0; dayCount < MAX_DAYS && cursor <= endAt; dayCount++) {
    const schedule = scheduleMap.get(cursor.getDay())

    if (schedule && schedule.is_active && !isHoliday(cursor, holidays)) {
      const startMin = timeToMinutes(schedule.start_time)
      const endMin = timeToMinutes(schedule.end_time)
      const dayWindowStart = new Date(cursor)
      dayWindowStart.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
      const dayWindowEnd = new Date(cursor)
      dayWindowEnd.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)

      const overlapStart = dayWindowStart < startAt ? startAt : dayWindowStart
      const overlapEnd = dayWindowEnd > endAt ? endAt : dayWindowEnd
      if (overlapEnd > overlapStart) {
        total += (overlapEnd.getTime() - overlapStart.getTime()) / 60000
      }
    }

    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(0, 0, 0, 0)
  }

  return total
}
