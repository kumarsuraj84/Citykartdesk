'use client'

import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react'
import type { Delta } from '@/lib/reporting/executive/engine'

/** "▲ +12%" in green / red / grey depending on whether the change is good for that measure. */
export function DeltaBadge({ d, className = '' }: { d: Delta | null; className?: string }) {
  if (!d) return null
  const tone = d.tone === 'good' ? 'text-success' : d.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground'
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '='
  return <span className={`whitespace-nowrap text-[11.5px] font-bold tabular-nums ${tone} ${className}`}>{arrow} {d.text}</span>
}

/** A small trend line that fills the width of its container, with the previous period dashed behind it. */
export function Spark({ values, prev, color = 'var(--primary)', className = 'h-8 w-full' }: {
  values: (number | null)[]; prev?: (number | null)[] | null; color?: string; className?: string
}) {
  const all = [...values, ...(prev ?? [])].filter((x): x is number => x !== null)
  if (values.filter((x) => x !== null).length < 2) return <div className={className} aria-hidden />
  const mx = Math.max(...all)
  const mn = Math.min(...all, 0)
  const w = 100
  const h = 30
  const line = (arr: (number | null)[]) => {
    const pts: string[] = []
    arr.forEach((x, i) => {
      if (x === null) return
      pts.push(`${((i / Math.max(1, arr.length - 1)) * w).toFixed(1)},${(h - 3 - (mx === mn ? 0.5 : (x - mn) / (mx - mn)) * (h - 6)).toFixed(1)}`)
    })
    return pts.join(' ')
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden className={`block overflow-hidden ${className}`}>
      {prev && prev.filter((x) => x !== null).length > 1 && (
        <polyline points={line(prev)} fill="none" stroke="var(--muted-foreground)" strokeWidth="1.2" strokeDasharray="3 3" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.7" />
      )}
      <polyline points={line(values)} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm ${className}`}>{children}</section>
}

export function PanelTitle({ title, caption, right }: { title: ReactNode; caption?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

export function SectionKicker({ title, caption }: { title: string; caption?: string }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
    </div>
  )
}

/** A row of pill buttons where one is selected. */
export function Seg<T extends string>({ value, options, onChange, label, tone = 'plain' }: {
  value: T | null; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string; tone?: 'plain' | 'strong'
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex items-center gap-1 rounded-lg p-1 ${tone === 'strong' ? 'bg-muted' : 'bg-muted/70'}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${value === o.value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SelectBox({ value, onChange, options, label, active = false, tone = 'primary' }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; active?: boolean; tone?: 'primary' | 'danger'
}) {
  const on = tone === 'danger' ? 'border-destructive bg-destructive/10 font-semibold text-destructive' : 'border-primary bg-primary/10 font-semibold text-primary'
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`max-w-[15rem] rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? on : 'border-border bg-muted/40 text-foreground hover:bg-muted'}`}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

/** The two-colour SLA mark used in every table: green tick for within SLA, red alert for breached. */
export function SlaMark({ breached, short = false }: { breached: boolean; short?: boolean }) {
  return breached ? (
    <span className="inline-flex items-center gap-1 font-semibold text-destructive"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{short ? 'SLA !' : 'Breached'}</span>
  ) : (
    <span className="inline-flex items-center gap-1 font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />OK</span>
  )
}

/** SLA % with the same traffic-light treatment as the matrices (<=35 red, <75 amber, otherwise green). */
export function SlaPercent({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">-</span>
  if (value <= 35) return <span className="inline-flex items-center gap-1 font-bold text-destructive"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{value.toFixed(0)}%</span>
  if (value < 75) return <span className="font-semibold text-warning">{value.toFixed(0)}%</span>
  return <span className="inline-flex items-center gap-1 font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{value.toFixed(0)}%</span>
}

export function Chev({ className = '' }: { className?: string }) {
  return <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary ${className}`} />
}

/** A thin proportional bar. `parts` are shares that add up to roughly 100. */
export function SplitBar({ parts }: { parts: { pct: number; className: string; title?: string }[] }) {
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {parts.filter((p) => p.pct > 0).map((p, i) => <div key={i} className={`h-full ${p.className}`} style={{ width: `${p.pct}%` }} title={p.title} />)}
    </div>
  )
}
