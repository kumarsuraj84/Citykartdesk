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
}> => {
  const supabase = await createClient()
  const [{ data: bizHours }, { data: holidaysData }] = await Promise.all([
    supabase.from('business_hours').select('*').order('day_of_week'),
    supabase.from('holidays').select('*'),
  ])

  const scheduleMap = new Map<number, DaySchedule>()
  for (const row of bizHours ?? []) {
    scheduleMap.set(row.day_of_week, {
      start_time: row.start_time,
      end_time: row.end_time,
      is_active: row.is_active,
    })
  }
  return { scheduleMap, holidays: (holidaysData ?? []) as Holiday[] }
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
  const { scheduleMap, holidays } = await getSLACalendar()

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

  // No business capacity found anywhere within the bound — every configured
  // day is inactive, no business_hours rows exist at all, or every row's
  // window is zero/negative width. This is a configuration problem, not a
  // valid SLA outcome, so it's surfaced (logged + an operator alert) and
  // returned as "no deadline" rather than silently becoming "now + ~5 years."
  logger.error({
    event: 'sla.business_hours.no_usable_window',
    message: 'SLA deadline could not be computed — the business-hours calendar has no usable window (all inactive, no rows configured, or every window is zero/negative width)',
    route: 'lib/sla/business-hours.ts#computeSLADeadline',
    errorCode: 'sla_business_hours_misconfigured',
    context: { scheduleRowCount: scheduleMap.size, slaDurationMinutes },
  })
  await alertOperator({
    key: 'sla.business_hours.no_usable_window',
    severity: 'critical',
    title: 'SLA deadlines cannot be computed — business-hours calendar has no usable window',
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
