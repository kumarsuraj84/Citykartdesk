// Small text helpers shared by the Executive Dashboard parts.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const dayLabel = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}` }
export const dayLabelYear = (ms: number) => `${dayLabel(ms)} ${new Date(ms).getFullYear()}`
export const bucketLabel = (b: { start: number; end: number; step: number }) =>
  b.step === 1 ? dayLabel(b.start) : `${dayLabel(b.start)} - ${dayLabel(b.end)}`
export const timeLabel = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export const dateTimeLabel = (ms: number | null) => (ms === null ? '-' : `${dayLabelYear(ms)}, ${timeLabel(ms)}`)

/** "5.2h" under two days, "3.4 days" beyond. */
export function humanHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return '-'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)} days`
}
