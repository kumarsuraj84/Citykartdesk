/** Formats a non-negative duration in hours. A negative or non-finite input
 *  is never a valid duration (upstream data-quality issue, not a display
 *  concern) — rendered as "—" rather than a nonsensical "-90m" so a future
 *  caller that bypasses the analytics layer's own anomaly guard
 *  (lib/queries/analytics.ts's computeTatHours) still can't leak an
 *  impossible business state onto the screen. This intentionally does not
 *  clamp negative values to 0, which would silently hide the same anomaly
 *  behind a plausible-looking "0m".. */
export function fmtHours(h: number | null): string {
  if (h === null || !Number.isFinite(h) || h < 0) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}
