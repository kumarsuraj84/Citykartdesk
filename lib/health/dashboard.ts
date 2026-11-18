// Health & Performance dashboard: the small pure helpers behind the tiles and the line charts (so the numbers, the axes and the gaps have tests).

export type Pt = { t: number; v: number | null }

export function average(nums: number[]): number | null {
  const ok = nums.filter((n) => Number.isFinite(n))
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null
}

/** How far the latest value is from the average, in percent. null when there is nothing to compare (no average, or an average of zero). */
export function deltaPct(latest: number | null, avg: number | null): number | null {
  if (latest === null || avg === null || !Number.isFinite(latest) || !Number.isFinite(avg) || avg === 0) return null
  return ((latest - avg) / avg) * 100
}

/** "3%" with a direction; within one percent of the average is "flat". */
export function describeDelta(d: number | null): { text: string; dir: 'up' | 'down' | 'flat' | 'none' } {
  if (d === null) return { text: '—', dir: 'none' }
  const a = Math.abs(d)
  if (a < 1) return { text: '0%', dir: 'flat' }
  const text = a >= 1000 ? `${Math.round(a / 100) / 10}k%` : `${Math.round(a)}%`
  return { text, dir: d > 0 ? 'up' : 'down' }
}

/** A tidy top for an axis: 1, 2, 2.5, 5 or 10 times a power of ten that is at least the value. */
export function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/** Evenly spaced axis values from 0 to max (n steps). */
export function axisTicks(max: number, steps = 4): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => (max * i) / steps)
}

/** An axis number as short text: 950 -> "950", 12000 -> "12k", 2.5 -> "2.5". */
export function formatAxis(v: number): string {
  const a = Math.abs(v)
  if (a >= 10_000) return `${Math.round(v / 1000)}k`
  if (a >= 1000) return `${Math.round(v / 100) / 10}k`
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
}

/** Cuts a line where the data stops for longer than `maxGapMs` (a stopped server must show as a hole, not a smooth line across it). Points with no value are dropped. */
export function splitOnGaps(points: Pt[], maxGapMs: number): { t: number; v: number }[][] {
  const out: { t: number; v: number }[][] = []
  let cur: { t: number; v: number }[] = []
  let prev = -Infinity
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    if (p.v === null || !Number.isFinite(p.v)) continue
    if (cur.length && p.t - prev > maxGapMs) { out.push(cur); cur = [] }
    cur.push({ t: p.t, v: p.v })
    prev = p.t
  }
  if (cur.length) out.push(cur)
  return out
}

/** The usual spacing between points (the median gap), used to decide what counts as a hole. 0 when there are fewer than two points. */
export function medianGap(points: Pt[]): number {
  const ts = points.filter((p) => p.v !== null).map((p) => p.t).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1])
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/** The SVG path of one run of points. `step` draws a staircase (a value that holds until the next reading, like a count). */
export function linePath(run: { t: number; v: number }[], x: (t: number) => number, y: (v: number) => number, step = false): string {
  if (run.length === 0) return ''
  let d = `M${x(run[0].t).toFixed(1)},${y(run[0].v).toFixed(1)}`
  for (let i = 1; i < run.length; i++) {
    if (step) d += ` H${x(run[i].t).toFixed(1)} V${y(run[i].v).toFixed(1)}`
    else d += ` L${x(run[i].t).toFixed(1)},${y(run[i].v).toFixed(1)}`
  }
  if (run.length === 1) d += ` h0.1`   // a single reading still shows as a dot
  return d
}

/** Evenly spaced moments across a time window, for the labels under a chart. */
export function timeTicks(fromMs: number, toMs: number, count = 6): number[] {
  if (count < 2 || toMs <= fromMs) return [fromMs]
  return Array.from({ length: count }, (_, i) => fromMs + ((toMs - fromMs) * i) / (count - 1))
}

/** A moment as India time: "17:41" for a window of a day or less, "18 Nov" for longer ones. */
export function formatTick(ms: number, windowHours: number): string {
  const d = new Date(ms)
  return windowHours <= 36
    ? d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })
}
