// The month and its weeks for the Weekly Admin Report. A week runs Monday to Sunday and belongs to the month its days are in: the 1st of a month
// starts Week-1 even when it is a Friday (so Week-1 can be 1 to 7 days long), the next Monday starts Week-2, and the last week ends with the month.
// Most months have 5 weeks; one that starts late in the week can have 6, and then the report shows Week-6 too. The week numbers are the same as the
// "Week-N" every ticket already carries (facts.ts weekOfMonth), so this page and the other reports always agree.

import { monthLabel, weekOfMonth } from './facts'
import { istDay as istDayW } from '@/lib/reporting/ist'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface WeekRange { week: number; from: Date; to: Date }

export interface WeekMonth {
  /** "2026-10" */
  value: string
  year: number
  /** 1 to 12 */
  month: number
  /** "Oct-26", the label tickets carry */
  label: string
  /** "October 2026" */
  name: string
  start: Date
  /** the last moment of the month */
  end: Date
  weeks: WeekRange[]
}

/** The weeks of a month, Monday to Sunday, each cut at the month's own first and last day. */
export function weeksOfMonth(year: number, month: number): WeekRange[] {
  const last = new Date(year, month, 0)
  const out: WeekRange[] = []
  let from = new Date(year, month - 1, 1)
  while (from <= last) {
    const week = Number(weekOfMonth(from).slice(5))
    // the Sunday that ends this week (or the month's last day)
    const toDay = from.getDate() + ((7 - ((from.getDay() + 6) % 7)) - 1)
    const to = new Date(year, month - 1, Math.min(toDay, last.getDate()))
    out.push({ week, from, to })
    from = new Date(year, month - 1, to.getDate() + 1)
  }
  return out
}

/** "2026-10" → that month; anything else (or nothing) → the month `now` is in. */
export function resolveMonth(value: string | undefined | null, now: Date = new Date()): WeekMonth {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '')
  // the month it is in INDIA right now, whatever zone the server runs in (audit H-28)
  const [istY, istM] = istDayW(now).split('-').map(Number)
  let year = istY
  let month = istM
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 2000 && Number(m[1]) <= 2100) { year = Number(m[1]); month = Number(m[2]) }
  return {
    value: `${year}-${String(month).padStart(2, '0')}`,
    year, month,
    label: monthLabel(new Date(year, month - 1, 1)),
    name: `${MONTH_NAMES[month - 1]} ${year}`,
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0, 23, 59, 59, 999),
    weeks: weeksOfMonth(year, month),
  }
}

/** The most months the Monthly Admin Report shows at once. */
export const MAX_REPORT_MONTHS = 12

/** "2026-04,2026-05" → those months, oldest first (repeats and anything else dropped, at most 12); nothing valid → this month and the 2 before it (`fallback` months in all). */
export function resolveMonths(value: string | undefined | null, now: Date = new Date(), fallback = 3): WeekMonth[] {
  const picked = [...new Set((value ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)))].sort().slice(-MAX_REPORT_MONTHS)
  if (picked.length > 0) return picked.map((v) => resolveMonth(v, now))
  return Array.from({ length: fallback }, (_, i) => fallback - 1 - i).map((back) => {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
    return resolveMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, now)
  })
}

/** "01-Apr-26": a month's heading over its Open / Resolved pair. */
export function monthHeading(m: WeekMonth): string {
  return `01-${SHORT[m.month - 1]}-${String(m.year).slice(2)}`
}

/** The months to choose from: this month and the previous ones, newest first. */
export function monthOptions(now: Date = new Date(), count = 18): { value: string; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` }
  })
}

/** "1-4 Oct" or "5-11 Oct": what a week covers, for the line under the report's title. */
export function weekText(w: WeekRange): string {
  const a = w.from.getDate()
  const b = w.to.getDate()
  return `${a === b ? a : `${a}-${b}`} ${SHORT[w.to.getMonth()]}`
}
