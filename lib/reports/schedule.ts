// WHEN a scheduled report (Admin > Reports > Scheduled reports) is sent by itself. Pure (no database, no clock of its own): the runner passes "now".
//
// The rule, in words an administrator can read:
//   daily   - every day at 07:00 India time
//   weekly  - every Monday at 07:00 India time
//   monthly - on the 1st of the month at 07:00 India time
// A report is due when its latest slot (the most recent of those moments that has already passed) is later than the last time it was sent (or, for a report that was never sent,
// later than the moment it was created: a report made at 10:00 waits for the next slot, it is not sent at once for a slot it did not exist at).

export type ReportFrequency = 'daily' | 'weekly' | 'monthly'

const IST_OFFSET_MS = 330 * 60_000
/** the hour (India time) the reports go out */
export const SEND_HOUR_IST = 7
/** a report whose send failed completely is tried again at every run for this long after its slot, then it waits for the next slot */
export const RETRY_WINDOW_MS = 6 * 3_600_000

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The most recent moment (not after `now`) at which a report of this frequency is due. */
export function latestSlot(frequency: ReportFrequency, now: Date): Date {
  // work on the India wall clock: shift by +5:30, read with the UTC getters, shift back at the end
  const w = new Date(now.getTime() + IST_OFFSET_MS)
  const y = w.getUTCFullYear(), m = w.getUTCMonth(), d = w.getUTCDate()
  const at = (yy: number, mm: number, dd: number) => Date.UTC(yy, mm, dd, SEND_HOUR_IST, 0, 0, 0)   // an India wall-clock moment, as a shifted number
  let slot: number
  if (frequency === 'daily') {
    slot = at(y, m, d)
    if (slot > w.getTime()) slot = at(y, m, d - 1)
  } else if (frequency === 'weekly') {
    const back = (w.getUTCDay() + 6) % 7           // days since Monday (Monday = 0)
    slot = at(y, m, d - back)
    if (slot > w.getTime()) slot = at(y, m, d - back - 7)
  } else {
    slot = at(y, m, 1)
    if (slot > w.getTime()) slot = at(y, m - 1, 1)
  }
  return new Date(slot - IST_OFFSET_MS)
}

/** The next moment this report will go out (after `now`). */
export function nextSlot(frequency: ReportFrequency, now: Date): Date {
  const latest = latestSlot(frequency, now)
  const w = new Date(latest.getTime() + IST_OFFSET_MS)
  const y = w.getUTCFullYear(), m = w.getUTCMonth(), d = w.getUTCDate()
  const next = frequency === 'daily' ? Date.UTC(y, m, d + 1, SEND_HOUR_IST) : frequency === 'weekly' ? Date.UTC(y, m, d + 7, SEND_HOUR_IST) : Date.UTC(y, m + 1, 1, SEND_HOUR_IST)
  return new Date(next - IST_OFFSET_MS)
}

export type ScheduledReportTimes = { is_active: boolean; frequency: ReportFrequency; last_sent_at: string | null; created_at: string | null }

/** Is this report due now (its latest slot has passed since it was last sent / created)? */
export function isReportDue(report: ScheduledReportTimes, now: Date): boolean {
  if (!report.is_active) return false
  const slot = latestSlot(report.frequency, now)
  const since = Math.max(report.last_sent_at ? Date.parse(report.last_sent_at) : 0, report.created_at ? Date.parse(report.created_at) : 0)
  return since < slot.getTime()
}

/** A plain sentence for the screen: "every day at 07:00", "every Monday at 07:00", "on the 1st of every month at 07:00" (India time). */
export function describeSchedule(frequency: ReportFrequency): string {
  const hh = String(SEND_HOUR_IST).padStart(2, '0')
  if (frequency === 'daily') return `every day at ${hh}:00 India time`
  if (frequency === 'weekly') return `every ${DAY_NAMES[1]} at ${hh}:00 India time`
  return `on the 1st of every month at ${hh}:00 India time`
}
