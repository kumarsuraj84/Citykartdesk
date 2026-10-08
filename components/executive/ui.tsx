'use client'

import type { ReactNode } from 'react'
import type { Delta } from '@/lib/reporting/executive/engine'

export function DeltaBadge({ d, className = '' }: { d: Delta | null; className?: string }) {
  if (!d) return null
  const tone = d.tone === 'good' ? 'text-success' : d.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground'
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '='
  return <span className={`whitespace-nowrap text-[11px] font-bold ${tone} ${className}`}>{arrow} {d.text}</span>
}

export function Spark({ values }: { values: (number | null)[] }) {
  const v = values.filter((x): x is number => x !== null)
  if (v.length < 2) return null
  const mx = Math.max(...v)
  const mn = Math.min(...v)
  const w = 64
  const h = 26
  const pts: string[] = []
  values.forEach((x, i) => {
    if (x === null) return
    pts.push(`${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (mx === mn ? 0.5 : (x - mn) / (mx - mn)) * (h - 4)).toFixed(1)}`)
  })
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--primary)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

export function Card({ title, caption, actions, className = '', children }: {
  title: ReactNode; caption?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {caption && <p className="mb-3 mt-0.5 text-xs text-muted-foreground">{caption}</p>}
      {!caption && <div className="mb-3" />}
      {children}
    </section>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${value === o.value ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SelectBox({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export interface BarItem {
  key: string
  label?: string
  value: number
  text: string
  delta?: Delta | null
}

/** Horizontal bars. Click a bar = filter; the small arrow = open its details. */
export function BarList({ items, selected, onPick, onDrill, emptyText = 'Nothing to show for this selection' }: {
  items: BarItem[]
  selected: string[]
  onPick: (key: string) => void
  onDrill?: (key: string) => void
  emptyText?: string
}) {
  if (items.length === 0) return <p className="py-5 text-center text-xs text-muted-foreground">{emptyText}</p>
  const max = Math.max(1, ...items.map((i) => i.value))
  const anySel = selected.length > 0
  return (
    <div className="flex flex-col gap-1">
      {items.map((it) => {
        const sel = selected.includes(it.key)
        return (
          <div
            key={it.key}
            className={`grid grid-cols-[minmax(80px,140px)_1fr_auto_22px] items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60`}
          >
            <button type="button" onClick={() => onPick(it.key)} className={`truncate text-left text-[13px] ${sel ? 'font-bold text-primary' : 'text-foreground'}`} title={it.label ?? it.key}>
              {it.label ?? it.key}
            </button>
            <button type="button" onClick={() => onPick(it.key)} aria-label={`Filter by ${it.label ?? it.key}`} className="h-4 overflow-hidden rounded bg-muted text-left">
              <span
                className={`block h-full rounded transition-[width] duration-300 ${sel ? 'bg-primary' : anySel ? 'bg-muted-foreground/30' : 'bg-primary/55'}`}
                style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
              />
            </button>
            <span className="min-w-[70px] whitespace-nowrap text-right text-[12.5px] font-bold text-foreground">
              {it.text} {it.delta && <span className="ml-1"><DeltaSmall d={it.delta} /></span>}
            </span>
            {onDrill ? (
              <button
                type="button"
                onClick={() => onDrill(it.key)}
                title="Open details and drill down"
                aria-label={`Details of ${it.label ?? it.key}`}
                className="h-[22px] w-[22px] rounded-md border border-border bg-card text-[11px] font-extrabold leading-none text-primary hover:bg-primary hover:text-primary-foreground"
              >
                ▸
              </button>
            ) : <span />}
          </div>
        )
      })}
    </div>
  )
}

function DeltaSmall({ d }: { d: Delta }) {
  return <DeltaBadge d={d} className="!text-[10.5px]" />
}
