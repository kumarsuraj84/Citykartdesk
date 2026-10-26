// AC PMS: which PMS dates are due to become tickets right now. Pure (no database, no clock of its own), so it can be tested.
//   - a ticket for a date is made from 09:00 India time on that day, never before;
//   - a date missed because the job did not run is still made for up to PMS_CATCH_UP_DAYS days afterwards, never for older dates.

export const PMS_TICKET_HOUR_IST = 9
export const PMS_CATCH_UP_DAYS = 2

const TZ = 'Asia/Kolkata'

/** yyyy-mm-dd and minutes since midnight, in India time. */
export function istNow(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) }
}

/** The day before / after an yyyy-mm-dd (calendar arithmetic, no time zone involved). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The first and last PMS date that may become a ticket now. `to` is yesterday until 09:00 and today from 09:00. */
export function pmsDueRange(now: Date): { from: string; to: string; todayOpen: boolean } {
  const t = istNow(now)
  const todayOpen = t.minutes >= PMS_TICKET_HOUR_IST * 60
  const to = todayOpen ? t.date : addDays(t.date, -1)
  return { from: addDays(t.date, -PMS_CATCH_UP_DAYS), to, todayOpen }
}

/** "25 Oct 2026" */
export function pmsDateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}
