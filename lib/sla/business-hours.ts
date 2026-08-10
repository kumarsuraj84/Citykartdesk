import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

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
  const fullDate = date.toISOString().slice(0, 10)
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
 */
export async function computeSLADeadline(
  startAt: Date,
  slaDurationMinutes: number
): Promise<Date> {
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

  // Fallback: no business capacity found within the bound (e.g. all days inactive).
  return cursor
}

/**
 * Inverse of computeSLADeadline: sums the business minutes that fall between two
 * timestamps, honoring the same business-hours/holiday calendar. Used by the
 * escalation cron (app/api/escalation/run) to compute "% of SLA time elapsed" against
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
