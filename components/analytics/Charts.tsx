'use client'

import { useMemo } from 'react'
import { fmtHours } from '@/lib/utils/fmt'

// ── Colour palette ─────────────────────────────────────────────────────────────

const PALETTE = [
  'var(--chart-1)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
  'var(--chart-2)', 'var(--info)', 'var(--warning)', 'var(--success)',
]

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--destructive)',
  high:   'color-mix(in oklab, var(--destructive) 55%, var(--warning))',
  medium: 'var(--warning)',
  low:    'var(--success)',
}

const STATUS_COLORS: Record<string, string> = {
  open:              'var(--primary)',
  assigned:          'color-mix(in oklab, var(--primary) 55%, var(--info))',
  in_progress:       'var(--info)',
  waiting_user:      'var(--warning)',
  pending_approval:  'color-mix(in oklab, var(--warning) 60%, var(--destructive))',
  resolved:          'var(--success)',
  closed:            'var(--muted-foreground)',
  cancelled:         'color-mix(in oklab, var(--muted-foreground) 65%, transparent)',
}

const STATUS_LABELS: Record<string, string> = {
  open:             'Open',
  assigned:         'Assigned',
  in_progress:      'In Progress',
  waiting_user:     'Waiting on User',
  pending_approval: 'Pending Approval',
  resolved:         'Resolved',
  closed:           'Closed',
  cancelled:        'Cancelled',
}

const PROJECT_STATUS_COLORS: Record<string, string> = {
  not_started: 'var(--muted-foreground)',
  in_progress: 'var(--info)',
  blocked:     'var(--destructive)',
  done:        'var(--success)',
  cancelled:   'color-mix(in oklab, var(--muted-foreground) 65%, transparent)',
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked:     'Blocked',
  done:        'Done',
  cancelled:   'Cancelled',
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, sub, accent = 'var(--primary)', danger = false, onClick,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: string
  danger?: boolean
  onClick?: () => void
}) {
  const isAlert = danger && Number(value) > 0
  const accentColor = isAlert ? 'var(--destructive)' : accent
  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col rounded-xl border bg-card overflow-hidden transition-all duration-150 ${
        isAlert
          ? 'border-destructive/40'
          : 'border-border'
      } ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 hover:border-opacity-0' : ''}`}
      style={onClick ? { '--tw-shadow-color': `color-mix(in oklab, ${accentColor} 13%, transparent)` } as React.CSSProperties : undefined}
    >
      {/* Accent bar */}
      <div className="h-[3px] w-full" style={{ background: accentColor }} />

      <div className="px-4 pt-3 pb-3.5 flex flex-col gap-0.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <p
          className={`font-extrabold leading-none tracking-tight tabular-nums ${
            isAlert ? 'text-destructive' : 'text-foreground'
          }`}
          style={{ fontSize: '28px' }}
        >
          {value}
        </p>
        {sub && (
          <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>
        )}
      </div>

      {/* Hover glow strip */}
      {onClick && (
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-xl"
          style={{ boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${accentColor} 33%, transparent)` }}
        />
      )}
    </div>
  )
}

// ── Donut Chart ────────────────────────────────────────────────────────────────

export function DonutChart({
  data,
  size = 140,
}: {
  data: Array<{ label: string; value: number; color?: string; onClick?: () => void }>
  size?: number
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = 40
  const circ = 2 * Math.PI * r
  const cx = 50
  const cy = 50
  const strokeWidth = 14

  const segments = useMemo(() => {
    const dashes = data.map((d) => (total ? d.value / total : 0) * circ)
    // Inclusive running total of dash lengths, computed without mutating a captured variable.
    const cumulative = dashes.reduce<number[]>(
      (acc, dash, i) => [...acc, (i === 0 ? 0 : acc[i - 1]) + dash],
      []
    )
    return data.map((d, i) => {
      const dash = dashes[i]
      const gap = circ - dash
      const offset = cumulative[i] - dash
      return { ...d, dash, gap, offset, color: d.color ?? PALETTE[i % PALETTE.length] }
    })
  }, [data, circ, total])

  if (!total) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        No data
      </div>
    )
  }

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox="0 0 100 100">
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${seg.dash} ${seg.gap}`}
            strokeDashoffset={-seg.offset + circ * 0.25}
            strokeLinecap="butt"
            onClick={seg.onClick}
            className={seg.onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="text-foreground" style={{ fontSize: 14, fontWeight: 700, fill: 'currentColor' }}>
          {total}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" style={{ fontSize: 7, fill: 'var(--muted-foreground)' }}>
          total
        </text>
      </svg>
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: seg.color }}
            />
            <span className="flex-1 truncate text-muted-foreground">{seg.label}</span>
            <span className="font-semibold text-foreground tabular-nums">{seg.value}</span>
            <span className="text-muted-foreground/60 tabular-nums w-8 text-right">
              {total ? `${Math.round((seg.value / total) * 100)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Vertical Bar Chart ─────────────────────────────────────────────────────────

export function BarChart({
  data,
  height = 160,
  color = 'var(--primary)',
}: {
  data: Array<{ label: string; value: number; color?: string }>
  height?: number
  color?: string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  if (!data.length) return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">No data</div>
  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end gap-1.5 h-full pb-6 relative">
        {data.map((d, i) => {
          const pct = (d.value / max) * 100
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group relative">
              <div
                className="w-full max-w-[40px] rounded-t transition-all duration-300"
                style={{
                  height: `calc(${pct}% - 20px)`,
                  background: d.color ?? color,
                  minHeight: d.value > 0 ? 4 : 0,
                }}
              />
              {/* Tooltip on hover */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap rounded-md bg-popover border border-border shadow px-2 py-1 text-xs font-semibold">
                {d.label}: {d.value}
              </div>
              <span className="absolute bottom-0 text-[9px] text-muted-foreground text-center leading-tight">
                {d.label.length > 6 ? d.label.slice(0, 5) + '…' : d.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Horizontal Bar ─────────────────────────────────────────────────────────────

export function HorizBar({
  data,
  color = 'var(--primary)',
  showValue = true,
}: {
  data: Array<{ label: string; value: number; color?: string; onClick?: () => void }>
  color?: string
  showValue?: boolean
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  if (!data.length) return <div className="py-4 text-xs text-muted-foreground text-center">No data</div>
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div
          key={i}
          onClick={d.onClick}
          className={`flex items-center gap-2 ${d.onClick ? 'cursor-pointer group hover:bg-muted/40 rounded px-1 -mx-1 py-0.5 transition-colors' : ''}`}
        >
          <span className="w-28 shrink-0 text-xs text-muted-foreground truncate text-right">{d.label}</span>
          <div className="flex-1 rounded-full bg-muted h-2.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? color }}
            />
          </div>
          {showValue && (
            <span className="w-8 text-xs font-semibold text-foreground tabular-nums text-right shrink-0">
              {d.value}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Line / Area Chart ──────────────────────────────────────────────────────────

export function LineAreaChart({
  data,
  height = 160,
  series,
}: {
  data: Array<Record<string, string | number>>
  height?: number
  series: Array<{ key: string; label: string; color: string; fill?: string }>
}) {
  const W = 600
  const H = height
  const PAD = { top: 12, right: 8, bottom: 28, left: 36 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxVal = Math.max(
    ...data.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0))),
    1
  )

  const xScale = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * chartW
  const yScale = (v: number) => PAD.top + chartH - (v / maxVal) * chartH

  // Build path for each series
  function linePath(key: string) {
    return data
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)},${yScale(Number(d[key] ?? 0)).toFixed(1)}`)
      .join(' ')
  }
  function areaPath(key: string) {
    const bottom = PAD.top + chartH
    const pts = data
      .map((d, i) => `${xScale(i).toFixed(1)},${yScale(Number(d[key] ?? 0)).toFixed(1)}`)
      .join(' L ')
    const lastX = xScale(data.length - 1).toFixed(1)
    const firstX = xScale(0).toFixed(1)
    return `M ${pts} L ${lastX},${bottom} L ${firstX},${bottom} Z`
  }

  // X-axis labels — sample to avoid overlap
  const step = Math.max(1, Math.floor(data.length / 7))
  const xLabels = data
    .map((d, i) => ({ i, label: String(d.date ?? '').slice(5) })) // MM-DD
    .filter((_, i) => i % step === 0 || i === data.length - 1)

  // Y-axis gridlines
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    v: Math.round(maxVal * pct),
    y: yScale(maxVal * pct),
  }))

  if (!data.length) return <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>No data</div>

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={t.y} x2={PAD.left + chartW} y2={t.y}
              stroke="currentColor" strokeOpacity={0.08} strokeWidth={1}
            />
            <text x={PAD.left - 4} y={t.y + 4} textAnchor="end"
              style={{ fontSize: 9, fill: 'var(--muted-foreground)' }}>{t.v}</text>
          </g>
        ))}

        {/* Area fills */}
        {series.map((s) => s.fill && (
          <path key={`fill-${s.key}`} d={areaPath(s.key)} fill={s.fill} opacity={0.15} />
        ))}

        {/* Lines */}
        {series.map((s) => (
          <path
            key={`line-${s.key}`}
            d={linePath(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* X labels */}
        {xLabels.map(({ i, label }) => (
          <text
            key={i}
            x={xScale(i)}
            y={H - 4}
            textAnchor="middle"
            style={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
          >
            {label}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 px-1">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-5 h-0.5 rounded" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── SLA Gauge (simple % bar) ───────────────────────────────────────────────────

export function SlaGauge({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  const pct = value ?? 0
  const color = pct >= 90 ? 'var(--success)' : pct >= 75 ? 'var(--warning)' : 'var(--destructive)'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold" style={{ color }}>
          {value !== null ? `${value}%` : '—'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── Aging Bar ─────────────────────────────────────────────────────────────────

export function AgingBar({ aging }: { aging: { d1: number; d7: number; d30: number; d30plus: number } }) {
  const bands = [
    { label: '< 1 day',  value: aging.d1,     color: 'var(--success)' },
    { label: '1–7 days', value: aging.d7,     color: 'var(--warning)' },
    { label: '7–30 days',value: aging.d30,    color: 'color-mix(in oklab, var(--warning) 60%, var(--destructive))' },
    { label: '30+ days', value: aging.d30plus, color: 'var(--destructive)' },
  ]
  const total = bands.reduce((s, b) => s + b.value, 0)
  if (!total) return <p className="text-xs text-muted-foreground py-2">No open tickets</p>

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-5 rounded-full overflow-hidden gap-px">
        {bands.map((b) => (
          <div
            key={b.label}
            title={`${b.label}: ${b.value}`}
            style={{ width: `${(b.value / total) * 100}%`, background: b.color }}
            className="transition-all duration-500"
          />
        ))}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 gap-1.5">
        {bands.map((b) => (
          <div key={b.label} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: b.color }} />
            <span className="text-muted-foreground">{b.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Priority badge ─────────────────────────────────────────────────────────────

export function PriorityBadge({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] ?? 'var(--muted-foreground)'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      style={{ background: color }}
    >
      {priority}
    </span>
  )
}

// ── Re-exports ─────────────────────────────────────────────────────────────────

export { fmtHours, PRIORITY_COLORS, STATUS_COLORS, STATUS_LABELS, PALETTE, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABELS }
