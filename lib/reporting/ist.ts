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
