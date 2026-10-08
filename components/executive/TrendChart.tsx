'use client'

import { formatMeasure, type Measure, type TimeBucket } from '@/lib/reporting/executive/engine'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayLabel = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}` }
export const bucketLabel = (b: { start: number; end: number; step: number }) =>
  b.step === 1 ? dayLabel(b.start) : `${dayLabel(b.start)} - ${dayLabel(b.end)}`

/** Bars for the chosen measure over time, with the previous period as a dashed line. A click on a bar zooms the page to it. */
export function TrendChart({ measure, buckets, current, previous, selectedStart, onPick, formatValue }: {
  measure: Measure
  buckets: TimeBucket[]
  current: (number | null)[]
  previous: (number | null)[] | null
  selectedStart: number | null
  onPick: (i: number) => void
  /** formats a number for the axis and tooltips (defaults to the measure's own format) */
  formatValue?: (v: number | null) => string
}) {
  const fmt = formatValue ?? ((v: number | null) => formatMeasure(measure, v))
  const w = 760
  const h = 230
  const left = 40
  const bottom = 26
  const top = 10
  const all = [...current, ...(previous ?? [])].filter((x): x is number => x !== null)
  const mx = Math.max(1, ...all) * 1.12
  const bw = (w - left - 6) / Math.max(1, buckets.length)
  const every = Math.ceil(buckets.length / 10)
  const plotH = h - top - bottom

  const prevPts: string[] = []
  if (previous) previous.forEach((v, i) => { if (v !== null && i < buckets.length) prevPts.push(`${(left + i * bw + bw / 2).toFixed(1)},${(h - bottom - plotH * (v / mx)).toFixed(1)}`) })

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: 260 }} role="img" aria-label={`Trend chart`}>
        {[0, 1, 2, 3, 4].map((g) => {
          const y = top + plotH * (1 - g / 4)
          return (
            <g key={g}>
              <line x1={left} x2={w} y1={y} y2={y} stroke="var(--border)" />
              <text x={left - 5} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{fmt((mx * g) / 4)}</text>
            </g>
          )
        })}
        {current.map((v, i) => {
          const hh = v === null ? 0 : plotH * (v / mx)
          const x = left + i * bw
          const sel = selectedStart !== null && buckets[i].start === selectedStart
          return (
            <g key={buckets[i].start} onClick={() => onPick(i)} style={{ cursor: 'pointer' }} role="button" aria-label={`Zoom to ${bucketLabel(buckets[i])}`}>
              <rect x={x} y={top} width={bw} height={plotH} fill="transparent" />
              <rect
                x={x + bw * 0.12} y={h - bottom - hh} width={bw * 0.76} height={Math.max(hh, 0)} rx={3}
                fill={sel ? 'var(--primary)' : selectedStart !== null ? 'color-mix(in srgb, var(--muted-foreground) 30%, transparent)' : 'color-mix(in srgb, var(--primary) 55%, transparent)'}
              >
                <title>{`${bucketLabel(buckets[i])}: ${fmt(v)}`}</title>
              </rect>
              {i % every === 0 && <text x={x + bw / 2} y={h - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{dayLabel(buckets[i].start)}</text>}
            </g>
          )
        })}
        {prevPts.length > 1 && <polyline points={prevPts.join(' ')} fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray="5 4" />}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-primary/55" /> this period</span>
        {previous && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-muted-foreground" /> previous period</span>}
        <span className="ml-auto">Click a bar to zoom the whole page into that {buckets[0]?.step === 1 ? 'day' : 'week'}</span>
      </div>
    </div>
  )
}
