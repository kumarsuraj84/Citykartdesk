// Health & Performance dashboard pieces: a figure strip, chart cards with line charts, and a status strip. Drawn on the server, no chart library.
import { axisTicks, formatAxis, formatTick, linePath, medianGap, niceMax, splitOnGaps, timeTicks, describeDelta, deltaPct, type Pt } from '@/lib/health/dashboard'

export type ChartSeries = { name: string; color: string; points: Pt[]; axis?: 'l' | 'r'; step?: boolean; dashed?: boolean }

/** A white card with a bold title, a grey line saying what the chart shows, and the colour key. */
export function ChartCard({ title, description, series, children }: { title: string; description: string; series?: { name: string; color: string; dashed?: boolean }[]; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        {series && series.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {series.map((s) => (
              <li key={s.name} className="flex items-center gap-1">
                <i className="inline-block h-0 w-4" style={{ borderTop: `2px ${s.dashed ? 'dashed' : 'solid'} ${s.color}` }} aria-hidden />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </header>
      <div className="px-2 pb-2 pt-3">{children}</div>
    </section>
  )
}

/**
 * A line chart drawn on the server: up to two scales (left and right), several lines, an optional dashed limit, times in India time.
 * A line stops where the readings stop (a stopped server shows as a hole, never as a smooth line across it); the newest reading is marked with a dot.
 * fromMs / toMs is the whole window, so a window that is only partly filled shows its empty part honestly.
 */
export function LineChart({ series, fromMs, toMs, leftUnit = '', rightUnit = '', leftMax, rightMax, limit, emptyText = 'No readings in this period yet.' }: {
  series: ChartSeries[]; fromMs: number; toMs: number; leftUnit?: string; rightUnit?: string; leftMax?: number; rightMax?: number
  limit?: { value: number; label: string }; emptyText?: string
}) {
  const hasData = series.some((s) => s.points.some((p) => p.v !== null))
  if (!hasData) return <p className="flex h-40 items-center justify-center text-xs text-muted-foreground">{emptyText}</p>
  const hasRight = series.some((s) => s.axis === 'r')
  const W = 720, H = 230, PL = 50, PR = hasRight ? 50 : 14, PT = 10, PB = 26
  const maxOf = (axis: 'l' | 'r') => Math.max(0, ...series.filter((s) => (s.axis ?? 'l') === axis).flatMap((s) => s.points.map((p) => p.v ?? 0)), axis === 'l' ? limit?.value ?? 0 : 0)
  const lMax = leftMax ?? niceMax(maxOf('l') * 1.05)
  const rMax = rightMax ?? niceMax(maxOf('r') * 1.05)
  const x = (t: number) => PL + ((t - fromMs) / Math.max(1, toMs - fromMs)) * (W - PL - PR)
  const yFor = (max: number) => (v: number) => PT + (1 - Math.min(v, max) / max) * (H - PT - PB)
  const yl = yFor(lMax), yr = yFor(rMax)
  const hours = (toMs - fromMs) / 3_600_000
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label={series.map((s) => s.name).join(', ')}>
      {axisTicks(lMax, 4).map((v) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={yl(v)} y2={yl(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={PL - 6} y={yl(v) + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{formatAxis(v)}{v === lMax && leftUnit ? ` ${leftUnit}` : ''}</text>
        </g>
      ))}
      {hasRight && axisTicks(rMax, 4).map((v) => (
        <text key={v} x={W - PR + 6} y={yr(v) + 3} textAnchor="start" fontSize="10" fill="var(--muted-foreground)">{formatAxis(v)}{v === rMax && rightUnit ? ` ${rightUnit}` : ''}</text>
      ))}
      {timeTicks(fromMs, toMs, 6).map((t, i, all) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'} fontSize="10" fill="var(--muted-foreground)">{formatTick(t, hours)}</text>
      ))}
      {limit && (
        <g>
          <line x1={PL} x2={W - PR} y1={yl(limit.value)} y2={yl(limit.value)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" />
          <text x={W - PR - 2} y={yl(limit.value) - 3} textAnchor="end" fontSize="9" fill="#ef4444">{limit.label}</text>
        </g>
      )}
      {series.map((s) => {
        const y = (s.axis ?? 'l') === 'r' ? yr : yl
        const gap = Math.max(medianGap(s.points) * 1.6, 60_000)   // one missing reading already shows as a hole
        const runs = splitOnGaps(s.points, gap)
        const lastRun = runs[runs.length - 1]
        const last = lastRun ? lastRun[lastRun.length - 1] : null
        return (
          <g key={s.name}>
            {runs.map((run, i) => (
              <path key={i} d={linePath(run, x, y, s.step)} fill="none" stroke={s.color} strokeWidth={s.step ? 1.3 : 1.8} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
            ))}
            {last && <circle cx={x(last.t)} cy={y(last.v)} r="2.6" fill={s.color}><title>{`${s.name}: ${formatAxis(last.v)}`}</title></circle>}
          </g>
        )
      })}
    </svg>
  )
}

/** The row of figures across the top: a big number, its unit, and how far it is from the average of the period (red arrow up, green down). */
export function StatStrip({ items }: { items: { label: string; value: string; unit?: string; latest: number | null; avg: number | null; avgText: string }[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
      {items.map((it) => {
        const d = describeDelta(deltaPct(it.latest, it.avg))
        const cls = d.dir === 'up' ? 'text-red-600 dark:text-red-400' : d.dir === 'down' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
        return (
          <div key={it.label} className="px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{it.label}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{it.value}{it.unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{it.unit}</span>}</p>
            <p className="mt-0.5 font-mono text-[11px]">
              <span className={cls}>{d.dir === 'up' ? '↗' : d.dir === 'down' ? '↘' : '→'} {d.text}</span>
              <span className="text-muted-foreground"> · avg {it.avgText}</span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

const ICONS = {
  heart: 'M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  gauge: 'M12 14l4-4M3 14a9 9 0 1 1 18 0',
  users: 'M16 20v-1a4 4 0 0 0-8 0v1M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  disk: 'M3 7h18v10H3zM7 12h.01',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
} as const

/** The row of status tiles along the bottom: an icon, a label, a short value and one line of explanation. tone marks a tile that needs attention. */
export function StatusStrip({ items }: { items: { icon: keyof typeof ICONS; label: string; value: string; note: string; tone?: 'ok' | 'warn' | 'bad' }[] }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 sm:divide-x lg:grid-cols-6 lg:divide-y-0">
      {items.map((it) => (
        <div key={it.label} className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${it.tone === 'bad' ? 'text-red-600' : it.tone === 'warn' ? 'text-amber-600' : 'text-emerald-600'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[it.icon]} /></svg>
            {it.label}
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-foreground">{it.value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{it.note}</p>
        </div>
      ))}
    </div>
  )
}
