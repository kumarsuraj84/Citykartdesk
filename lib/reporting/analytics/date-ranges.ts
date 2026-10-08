// Date-range presets for the predefined Report Analytics reports. Dates are calendar days in the
// server's local time zone (Asia/Kolkata in production). The financial year runs 1 April – 31 March.

export type RangePreset =
  | 'all' | 'today' | 'last_7' | 'last_30'
  | 'this_month' | 'last_month'
  | 'this_year' | 'last_year'
  | 'this_fy' | 'last_fy'
  | 'custom'

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'all',        label: 'All time' },
  { value: 'today',      label: 'Today' },
  { value: 'last_7',     label: 'Last 7 days' },
  { value: 'last_30',    label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year',  label: 'This year (1 Jan to today)' },
  { value: 'last_year',  label: 'Last year' },
  { value: 'this_fy',    label: 'This financial year (1 Apr to today)' },
  { value: 'last_fy',    label: 'Last financial year' },
  { value: 'custom',     label: 'Custom (from – to)' },
]

export interface ResolvedRange {
  preset: RangePreset
  /** Inclusive first day, or null for "no lower bound". */
  from: Date | null
  /** Inclusive last day (end of that day), or null for "no upper bound". */
  to: Date | null
  /** Human text for the report header and the Excel export, e.g. "1 Apr 2026 – 8 Oct 2026". */
  label: string
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const formatDay = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

/** Parses a yyyy-mm-dd string as a local calendar day; null when it is not a real date. */
export function parseDay(s: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null
}

export function isRangePreset(v: string | undefined): v is RangePreset {
  return RANGE_PRESETS.some((p) => p.value === v)
}

function labelFor(from: Date | null, to: Date | null): string {
  if (!from && !to) return 'All dates'
  if (from && to) return `${formatDay(from)} – ${formatDay(to)}`
  return from ? `From ${formatDay(from)}` : `Up to ${formatDay(to!)}`
}

export function resolveDateRange(
  preset: string | undefined,
  fromStr?: string,
  toStr?: string,
  now: Date = new Date()
): ResolvedRange {
  const today = startOfDay(now)
  const y = today.getFullYear()
  const mo = today.getMonth()
  const day = (yy: number, mm: number, dd: number) => new Date(yy, mm, dd)
  // Financial year containing today starts on 1 April of this year, or of last year if we are in Jan–Mar.
  const fyStartYear = mo >= 3 ? y : y - 1

  let p: RangePreset = isRangePreset(preset) ? preset : 'all'
  let from: Date | null = null
  let to: Date | null = null

  switch (p) {
    case 'all': break
    case 'today': from = today; to = endOfDay(today); break
    case 'last_7': from = day(y, mo, today.getDate() - 6); to = endOfDay(today); break
    case 'last_30': from = day(y, mo, today.getDate() - 29); to = endOfDay(today); break
    case 'this_month': from = day(y, mo, 1); to = endOfDay(today); break
    case 'last_month': from = day(y, mo - 1, 1); to = endOfDay(day(y, mo, 0)); break
    case 'this_year': from = day(y, 0, 1); to = endOfDay(today); break
    case 'last_year': from = day(y - 1, 0, 1); to = endOfDay(day(y - 1, 11, 31)); break
    case 'this_fy': from = day(fyStartYear, 3, 1); to = endOfDay(today); break
    case 'last_fy': from = day(fyStartYear - 1, 3, 1); to = endOfDay(day(fyStartYear, 2, 31)); break
    case 'custom': {
      const f = parseDay(fromStr)
      const t = parseDay(toStr)
      if (!f && !t) { p = 'all'; break }
      from = f ? startOfDay(f) : null
      to = t ? endOfDay(t) : null
      if (from && to && from > to) { const swap = from; from = startOfDay(to); to = endOfDay(swap) }
      break
    }
  }
  return { preset: p, from, to, label: labelFor(from, to) }
}

export interface ReferenceDay {
  start: Date
  end: Date
  isToday: boolean
  /** "today" or "on 7 Oct 2026" — for column headings like "Created today". */
  word: string
  /** "8 Oct 2026" */
  label: string
}

/**
 * The day the "created / resolved / closed that day" columns are about: the end of the chosen date range,
 * or today when the range has no end (or ends in the future). Looking at last month → its last day;
 * a custom range → its To date.
 */
export function referenceDay(range: Pick<ResolvedRange, 'to'>, now: Date = new Date()): ReferenceDay {
  const today = startOfDay(now)
  const base = range.to && startOfDay(range.to) < today ? startOfDay(range.to) : today
  const isToday = base.getTime() === today.getTime()
  return { start: base, end: endOfDay(base), isToday, word: isToday ? 'today' : `on ${formatDay(base)}`, label: formatDay(base) }
}
