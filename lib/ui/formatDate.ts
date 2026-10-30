// Date wording for screens that run in the browser. The server and the browser must print exactly the same
// text for the same moment, so the time zone is always India (the same zone lib/utils.ts uses), never the computer's own.

const TZ = 'Asia/Kolkata'

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "Jan 5, 2026" */
export function formatDate(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d ? d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }) : fallback
}

/** "Jan 5" (no year) */
export function formatDayMonth(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d ? d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) : fallback
}

/** "Jan 5, 2026, 15:45:09" (24-hour clock, with seconds: for the admin log screens) */
export function formatDateTimeSeconds(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d
    ? d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : fallback
}

/** "Jan 5, 15:45" (24-hour clock, no year) */
export function formatShortDateTime(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d
    ? d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : fallback
}

/** "Jan 5, 2026, 15:45" (24-hour clock, like the rest of the app) */
export function formatDateAndTime(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d
    ? d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : fallback
}

/**
 * A calendar day. Normally a day with no time ("2026-01-05", as a date box or a due-date column holds it).
 * It is read as that exact day whatever the computer's time zone is; building it with the computer's own midnight
 * would show the day before for people whose zone is behind UTC.
 * A full timestamp is also accepted and shown as its day in India.
 */
export function formatDateOnly(
  ymd: string | null | undefined,
  options: { year?: boolean } = { year: true },
  fallback = '—',
): string {
  if (!ymd) return fallback
  const yearPart = options.year === false ? {} : { year: 'numeric' as const }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...yearPart })
  }
  // a full timestamp: the day it is in India
  const t = new Date(ymd)
  if (Number.isNaN(t.getTime())) return fallback
  return t.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', ...yearPart })
}
