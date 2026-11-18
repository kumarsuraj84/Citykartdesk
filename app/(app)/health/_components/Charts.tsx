// Small server-drawn charts (no chart library): a bar strip of the last 30 days, and a two-line trend. Colours come from the theme tokens, so both themes work.

/** One thin bar per day: green = all good, amber = some failures, red = mostly failed, grey = no data that day. */
export function DayStrip({ days }: { days: { day: string; share: number | null }[] }) {
  return (
    <div className="flex h-6 items-end gap-[2px]" role="img" aria-label="Last 30 days, one bar per day">
      {days.map((d) => {
        const cls = d.share === null ? 'bg-muted' : d.share >= 0.999 ? 'bg-emerald-500' : d.share >= 0.9 ? 'bg-amber-400' : 'bg-red-500'
        const pct = d.share === null ? 'no data' : `${(d.share * 100).toFixed(d.share >= 0.99 ? 2 : 1)}% good`
        return <span key={d.day} title={`${d.day}: ${pct}`} className={`h-full min-w-[3px] flex-1 rounded-[1px] ${cls}`} />
      })}
    </div>
  )
}

export type TrendPoint = { at: string; a: number; b: number }

/** Typical (a) and 95th percentile (b) over time. y axis is milliseconds. */
export function Trend({ points, aLabel, bLabel, emptyText }: { points: TrendPoint[]; aLabel: string; bLabel: string; emptyText: string }) {
  if (points.length < 2) return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
  const W = 640, H = 140, PL = 40, PR = 8, PT = 8, PB = 18
  const maxY = Math.max(10, ...points.map((p) => Math.max(p.a, p.b)))
  const top = niceCeil(maxY)
  const t0 = new Date(points[0].at).getTime(), t1 = new Date(points[points.length - 1].at).getTime() || t0 + 1
  const x = (iso: string) => PL + ((new Date(iso).getTime() - t0) / Math.max(1, t1 - t0)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - v / top) * (H - PT - PB)
  const line = (k: 'a' | 'b') => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ')
  const fmtT = (ms: number) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label={`${aLabel} and ${bLabel} over time`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PL} x2={W - PR} y1={y(top * f)} y2={y(top * f)} stroke="var(--border)" strokeWidth="1" />
            <text x={PL - 4} y={y(top * f) + 3} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{Math.round(top * f)} ms</text>
          </g>
        ))}
        <path d={line('b')} fill="none" stroke="var(--chart-b, #f59e0b)" strokeWidth="1.6" />
        <path d={line('a')} fill="none" stroke="var(--primary)" strokeWidth="1.8" />
        <text x={PL} y={H - 4} fontSize="9" fill="var(--muted-foreground)">{fmtT(t0)}</text>
        <text x={W - PR} y={H - 4} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{fmtT(t1)}</text>
      </svg>
      <div className="mt-1 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-primary" />{aLabel}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4" style={{ background: '#f59e0b' }} />{bLabel}</span>
      </div>
    </div>
  )
}

function niceCeil(v: number): number {
  const steps = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 60000]
  return steps.find((s) => s >= v) ?? Math.ceil(v / 10000) * 10000
}
