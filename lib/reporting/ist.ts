// India Standard Time for the Report Builder. The database sends every timestamp in UTC ("2026-10-02T21:30:00+00:00"), and the Report Builder shows and
// exports a date as the first 10 characters of that text, so a ticket created at 03:00 on 3 October (IST, 21:30 on 2 October UTC) was listed on 2 October
// while its time column said 03:00. Every timestamp is therefore turned into India time ("2026-10-03T03:00:00.000+05:30") before the report sees it:
// its first 10 characters are the Indian date, its time column the Indian time, whatever time zone the server or the database runs in.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** "2026-10-02T21:30:00+00:00" → "2026-10-03T03:00:00.000+05:30". Anything that is not a full timestamp (a plain date, text, nothing) is returned as it is. */
export function istStamp(v: string): string {
  if (v.length <= 10) return v
  const ms = new Date(v).getTime()
  if (Number.isNaN(ms)) return v
  return new Date(ms + IST_OFFSET_MS).toISOString().replace('Z', '+05:30')
}

/** The India time of day, "03:00" (24-hour; midnight is 00:00). */
export function istTime(v: string | null | undefined): string | null {
  if (!v) return null
  const ms = new Date(v).getTime()
  if (Number.isNaN(ms)) return null
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(11, 16)
}

/** The India calendar day of a moment, "2026-10-03". */
export function istDay(v: Date | string | number): string {
  return new Date(new Date(v).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** The Sunday that starts the India week of a moment, "2026-09-27" (the trend charts group long periods by this). */
export function istWeekStart(v: Date | string | number): string {
  const d = new Date(new Date(v).getTime() + IST_OFFSET_MS)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

// ── India calendar days, computed the same way on the server, in the browser and in tests ──────────────────────────────────────────────────────
// The server's own clock zone is not something the code may rely on (audit H-28/F-11): a plain `new Date('2026-10-29')` is midnight UTC = 05:30 IST, so a
// task due today looked "overdue" for the whole working day, and `setHours(0,0,0,0)` is midnight wherever the server happens to run. Everything below works
// on "YYYY-MM-DD" texts and on fixed +05:30 moments, so one day means one thing on every screen.

const DAY_MS = 86_400_000

/** Today's India calendar day, "2026-10-29". */
export function istToday(now: Date = new Date()): string {
  return istDay(now)
}

/** The first 10 characters of a date or timestamp text ("2026-10-29" or "2026-10-29T00:00:00+00:00"): the calendar day a date column holds. */
export function dayOf(v: string): string {
  return v.slice(0, 10)
}

/** A date-only value (a task's due date) is overdue when its day is BEFORE today's India day; due today is not overdue. */
export function isOverdueDate(due: string | null | undefined, today: string = istToday()): boolean {
  return !!due && dayOf(due) < today
}

/** True when a date-only value is today's India day. */
export function isDueToday(due: string | null | undefined, today: string = istToday()): boolean {
  return !!due && dayOf(due) === today
}

/** The moment an India day starts, "2026-10-29" → "2026-10-29T00:00:00+05:30" (a text a database reads the same way whatever its own zone). */
export function istDayStartIso(day: string): string {
  return `${dayOf(day)}T00:00:00+05:30`
}

/** The moment an India day starts, as epoch ms. */
export function istDayStartMs(day: string): number {
  return new Date(istDayStartIso(day)).getTime()
}

/** The India day N days after (or before, when negative) the given India day. */
export function istAddDays(day: string, n: number): string {
  const d = new Date(`${dayOf(day)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** [from, to) as moments for an inclusive range of India days: from 00:00 IST on `fromDay` up to (not including) 00:00 IST the day after `toDay`. */
export function istRangeIso(fromDay: string, toDay: string): { gte: string; lt: string } {
  return { gte: istDayStartIso(fromDay), lt: istDayStartIso(istAddDays(toDay, 1)) }
}

/** The India calendar day the week-day / hour of a moment falls on: Sunday = 0 like Date#getDay, hour 0-23 (both in India time, not the browser's). */
export function istParts(v: Date | string | number): { day: string; weekday: number; hour: number; minute: number } {
  const d = new Date(new Date(v).getTime() + IST_OFFSET_MS)
  return { day: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

/** Whole days elapsed between two moments (rounded DOWN), the one way every screen ages a ticket. */
export function wholeDaysBetween(a: Date | string | number, b: Date | string | number): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS)
}
