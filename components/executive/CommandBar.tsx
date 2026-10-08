'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Calendar, Check, ChevronDown, Download, Layers, RotateCcw, Search, ShieldAlert, SlidersHorizontal, User, Wrench, X } from 'lucide-react'
import {
  PERIODS, STATUS_PRESETS, capitalize, emptyFilters, filterCount, isoDay, parseDay, quickRanges,
  type CustomRange, type Dim, type Filters, type Period, type SlaState,
} from '@/lib/reporting/executive/engine'
import { dayLabelYear } from '@/lib/reporting/executive/labels'
import type { ViewMode } from './types'
import { SelectBox } from './ui'

export interface Opt { value: string; label: string; count: number }
export interface FilterOptions { groups: Opt[]; techs: Opt[]; brands: Opt[]; statuses: Opt[]; prios: Opt[] }

const VIEW_TABS: { value: ViewMode; label: string }[] = [
  { value: 'stream', label: 'Full Executive Flow' },
  { value: 'velocity', label: 'Velocity & Queue' },
  { value: 'people', label: 'Workload & Approvals' },
  { value: 'matrices', label: 'Group & OEM Matrix' },
  { value: 'tickets', label: 'Heatmap & Tickets' },
]
const SLA_OPTIONS: { value: SlaState; label: string }[] = [
  { value: 'all', label: 'SLA: All tickets' },
  { value: 'breached', label: 'SLA breached only' },
  { value: 'ok', label: 'SLA compliant only' },
]

interface Props {
  title: string
  scopeLine: string
  now: number
  filters: Filters
  onFilters: (f: Filters) => void
  period: Period
  custom: CustomRange
  onPeriod: (p: Period) => void
  onCustom: (c: CustomRange) => void
  compareOn: boolean
  onCompare: (v: boolean) => void
  viewMode: ViewMode
  onViewMode: (v: ViewMode) => void
  options: FilterOptions
  showPeople: boolean
  periodText: string
  totalInPeriod: number
  onReset: () => void
  onExport: () => void
}

const setDim = (f: Filters, d: Dim, values: string[]): Filters => ({ ...f, dims: { ...f.dims, [d]: values } })
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
const presetOn = (sel: string[], values: string[]) => values.length === sel.length && values.every((v) => sel.includes(v))

// ── A drop-down where several values can be ticked ─────────────────────────────────────────────────

function MultiSelect({ label, allLabel, options, selected, onChange, display = (v) => v, presets, searchable = false }: {
  label: string; allLabel: string; options: Opt[]; selected: string[]; onChange: (v: string[]) => void
  display?: (v: string) => string; presets?: { label: string; values: string[] }[]; searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // a ticked value stays in the list even when the other filters would hide it
  const all: Opt[] = [...options, ...selected.filter((s) => !options.some((o) => o.value === s)).map((v) => ({ value: v, label: display(v), count: 0 }))]
  const shown = q ? all.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : all
  const text = selected.length === 0 ? `${allLabel} (${options.length})` : selected.length === 1 ? display(selected[0]) : `${display(selected[0])} +${selected.length - 1}`
  const usable = presets?.filter((p) => p.values.some((v) => all.some((o) => o.value === v)))

  return (
    <div ref={ref} className="relative">
      <button
        type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`inline-flex max-w-[15rem] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected.length ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border bg-muted/40 font-medium text-foreground hover:bg-muted'}`}
      >
        <span className="truncate">{text}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <div role="listbox" aria-label={`${label} choices`} aria-multiselectable className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-border bg-card p-2 shadow-xl">
          {usable && usable.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-border px-1 pb-2">
              {usable.map((p) => (
                <button key={p.label} type="button" onClick={() => onChange(presetOn(selected, p.values) ? [] : p.values.filter((v) => all.some((o) => o.value === v)))}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${presetOn(selected, p.values.filter((v) => all.some((o) => o.value === v))) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {(searchable || all.length > 12) && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase().replace('filter by ', '')}...`} aria-label={`Search ${label}`}
              className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
          )}
          <div className="mt-1 max-h-64 overflow-y-auto">
            {shown.map((o) => {
              const on = selected.includes(o.value)
              return (
                <label key={o.value} role="option" aria-selected={on} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted ${on ? 'font-semibold text-primary' : 'text-foreground'}`}>
                  <input type="checkbox" checked={on} onChange={() => onChange(toggle(selected, o.value))} className="h-3.5 w-3.5 rounded border-border accent-primary" />
                  <span className="flex-1 truncate">{o.label}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{o.count}</span>
                </label>
              )
            })}
            {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nothing matches.</p>}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-border px-1 pt-2">
            <button type="button" onClick={() => onChange([])} disabled={selected.length === 0} className="text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40">Clear</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function CommandBar(p: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [datesOpen, setDatesOpen] = useState(false)
  const active = filterCount(p.filters)
  const customLabel = `${dayLabelYear(parseDay(p.custom.start))} - ${dayLabelYear(parseDay(p.custom.end))}`.replace(/ 20\d\d/g, '')
  const f = p.filters

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>Analytics</span><span aria-hidden>/</span><span className="font-medium text-foreground">Smart Dashboard</span>
            <span aria-hidden>·</span><span className="font-medium text-primary">Click any number, bar or row to open the drill-down pop-up</span>
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{p.title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.scopeLine} · {p.periodText} · <strong className="tabular-nums text-foreground">{p.totalInPeriod} tickets</strong> in period
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex items-center gap-1 rounded-lg bg-muted p-1">
            {PERIODS.map((x) => (
              <button
                key={x.value} type="button" aria-pressed={p.period === x.value}
                onClick={() => { p.onPeriod(x.value); setDatesOpen(false) }}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${p.period === x.value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {x.short}
              </button>
            ))}
            <button
              type="button" aria-expanded={datesOpen} onClick={() => { setDatesOpen((v) => !v); setFiltersOpen(false) }}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${p.period === 'custom' || datesOpen ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-card/70'}`}
            >
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>{p.period === 'custom' ? customLabel : 'Custom Dates'}</span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
            {datesOpen && (
              <DatesPopover now={p.now} custom={p.custom} onClose={() => setDatesOpen(false)} onApply={(c) => { p.onCustom(c); setDatesOpen(false) }} />
            )}
          </div>

          <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50">
            <input type="checkbox" checked={p.compareOn} onChange={(e) => p.onCompare(e.target.checked)} className="peer sr-only" />
            <span className="relative h-4 w-7 rounded-full bg-muted-foreground/30 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-3 peer-focus-visible:ring-2 peer-focus-visible:ring-ring" />
            <span className="whitespace-nowrap">Compare period</span>
          </label>

          <button type="button" onClick={p.onExport} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/50">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* sticky filter bar + view lenses */}
      <div className="sticky top-0 z-30 space-y-2.5 rounded-xl border border-border bg-card/95 p-2.5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" onClick={() => { setFiltersOpen(true); setDatesOpen(false) }}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors ${active > 0 ? 'bg-primary hover:bg-primary/90' : 'bg-foreground hover:bg-foreground/90'}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
            {active > 0 && <span className="rounded bg-card px-1.5 text-[11px] font-bold tabular-nums text-primary">{active}</span>}
          </button>

          <div className="relative min-w-[13rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search" value={f.q} onChange={(e) => p.onFilters({ ...f, q: e.target.value })} aria-label="Search tickets"
              placeholder="Search ticket no, subject, store, technician..."
              className={`w-full rounded-lg border py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${f.q.trim() ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-muted/40 text-foreground focus:bg-background'}`}
            />
          </div>

          <MultiSelect label="Filter by group" allLabel="All groups" options={p.options.groups} selected={f.dims.group} onChange={(v) => p.onFilters(setDim(f, 'group', v))} />
          {p.showPeople && <MultiSelect label="Filter by technician" allLabel="All technicians" options={p.options.techs} selected={f.dims.tech} onChange={(v) => p.onFilters(setDim(f, 'tech', v))} searchable />}
          {p.options.brands.length > 0 && <MultiSelect label="Filter by OEM brand" allLabel="All OEM brands" options={p.options.brands} selected={f.dims.brand} onChange={(v) => p.onFilters(setDim(f, 'brand', v))} />}
          <MultiSelect
            label="Filter by status" allLabel="All statuses" options={p.options.statuses} selected={f.dims.status} onChange={(v) => p.onFilters(setDim(f, 'status', v))}
            display={(v) => p.options.statuses.find((s) => s.value === v)?.label ?? v} presets={STATUS_PRESETS.map((s) => ({ label: s.label, values: s.statuses }))}
          />
          <SelectBox label="Filter by SLA" value={f.sla} active={f.sla !== 'all'} tone="danger" onChange={(v) => p.onFilters({ ...f, sla: v as SlaState })} options={SLA_OPTIONS} />
          {(active > 0 || p.period !== '30d') && (
            <button type="button" onClick={p.onReset} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10">
              <RotateCcw className="h-3.5 w-3.5" /> Reset all
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {VIEW_TABS.map((t) => (
            <button
              key={t.value} type="button" aria-pressed={p.viewMode === t.value} onClick={() => p.onViewMode(t.value)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors ${p.viewMode === t.value ? 'bg-card font-semibold text-primary shadow-sm' : 'font-medium text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {filtersOpen && (
        <FiltersModal
          now={p.now} filters={p.filters} period={p.period} custom={p.custom} options={p.options} showPeople={p.showPeople}
          onClose={() => setFiltersOpen(false)}
          onApply={(nf, per, c) => { p.onFilters(nf); p.onPeriod(per); if (per === 'custom') p.onCustom(c); setFiltersOpen(false) }}
        />
      )}
    </div>
  )
}

// ── Custom dates ───────────────────────────────────────────────────────────────────────────────────

function DatesPopover({ now, custom, onApply, onClose }: { now: number; custom: CustomRange; onApply: (c: CustomRange) => void; onClose: () => void }) {
  const [start, setStart] = useState(custom.start)
  const [end, setEnd] = useState(custom.end)
  const ref = useRef<HTMLDivElement>(null)
  const today = isoDay(now)
  const valid = !Number.isNaN(parseDay(start)) && !Number.isNaN(parseDay(end)) && end >= start
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div ref={ref} role="dialog" aria-label="Select a custom date range" className="absolute right-0 top-full z-50 mt-2 w-80 space-y-4 rounded-xl border border-border bg-card p-4 shadow-xl sm:w-96">
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Select custom date range</h3>
          <p className="text-[11px] text-muted-foreground">Tickets created, resolved and open during the dates you pick</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quick windows</p>
        <div className="grid gap-1">
          {quickRanges(now).map((r) => {
            const on = start === r.start && end === r.end
            return (
              <button key={r.label} type="button" onClick={() => { setStart(r.start); setEnd(r.end) }}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${on ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground hover:bg-muted'}`}>
                <span>{r.label} <span className="text-muted-foreground">({r.start.slice(5)} → {r.end.slice(5)})</span></span>
                {on && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <label className="text-[11px] font-semibold text-muted-foreground">Start date
          <input type="date" value={start} max={end || today} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="text-[11px] font-semibold text-muted-foreground">End date
          <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">Cancel</button>
        <button type="button" disabled={!valid} onClick={() => onApply({ start, end })} className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Apply custom dates</button>
      </div>
    </div>
  )
}

// ── The filters pop-up (several values per filter) ────────────────────────────────────────────────

function OptionGrid({ icon, title, all, value, options, onChange, search = false, presets }: {
  icon: React.ReactNode; title: string; all: string; value: string[]; options: Opt[]; onChange: (v: string[]) => void; search?: boolean
  presets?: { label: string; values: string[] }[]
}) {
  const [q, setQ] = useState('')
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options
  const cell = (on: boolean) => `flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border text-foreground hover:bg-muted/60'}`
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{icon}{title}<span className="font-normal normal-case tracking-normal">(tick as many as you like)</span></p>
      {presets && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => <button key={p.label} type="button" onClick={() => onChange(presetOn(value, p.values) ? [] : p.values)} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${presetOn(value, p.values) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted'}`}>{p.label}</button>)}
        </div>
      )}
      {search && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />}
      <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
        <button type="button" onClick={() => onChange([])} className={cell(value.length === 0)}>{all}</button>
        {shown.map((o) => (
          <button key={o.value} type="button" aria-pressed={value.includes(o.value)} onClick={() => onChange(toggle(value, o.value))} className={cell(value.includes(o.value))}>
            <span className="truncate">{o.label}</span><span className="ml-1 text-[11px] tabular-nums text-muted-foreground">{o.count}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="col-span-2 py-2 text-center text-muted-foreground">Nothing matches.</p>}
      </div>
    </div>
  )
}

function FiltersModal({ now, filters, period, custom, options, showPeople, onClose, onApply }: {
  now: number; filters: Filters; period: Period; custom: CustomRange; options: FilterOptions; showPeople: boolean
  onClose: () => void; onApply: (f: Filters, p: Period, c: CustomRange) => void
}) {
  const [f, setF] = useState<Filters>(filters)
  const [per, setPer] = useState<Period>(period)
  const [start, setStart] = useState(custom.start)
  const [end, setEnd] = useState(custom.end)
  const today = isoDay(now)
  const validRange = !Number.isNaN(parseDay(start)) && !Number.isNaN(parseDay(end)) && end >= start
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  const pill = (on: boolean) => `rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? 'border-primary bg-primary text-primary-foreground font-semibold' : 'border-border bg-card text-foreground hover:bg-muted'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Dashboard filters" className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><SlidersHorizontal className="h-4 w-4" /></div>
            <div>
              <h2 className="text-base font-bold text-foreground">Dashboard filters</h2>
              <p className="text-xs text-muted-foreground">Combine group, technician, OEM equipment, queue status, SLA and dates. Every filter takes several values.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-6 overflow-y-auto p-6 text-xs">
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground"><Calendar className="h-3.5 w-3.5 text-primary" />Time period</p>
            <div className="flex flex-wrap items-center gap-2">
              {PERIODS.map((x) => <button key={x.value} type="button" onClick={() => setPer(x.value)} className={pill(per === x.value)}>{capitalize(x.label)}</button>)}
              <button type="button" onClick={() => setPer('custom')} className={pill(per === 'custom')}>Custom date window</button>
            </div>
            {per === 'custom' && (
              <div className="grid gap-3 pt-1 sm:grid-cols-2">
                <label className="font-semibold text-muted-foreground">From
                  <input type="date" value={start} max={end || today} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 tabular-nums text-foreground" />
                </label>
                <label className="font-semibold text-muted-foreground">To
                  <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 tabular-nums text-foreground" />
                </label>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground"><Search className="h-3.5 w-3.5" />Ticket search</p>
            <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Ticket number, subject, store, technician, OEM..." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <OptionGrid icon={<Building2 className="h-3.5 w-3.5" />} title="Technician group" all="All groups" value={f.dims.group} options={options.groups} onChange={(v) => setF(setDim(f, 'group', v))} />
            {options.brands.length > 0
              ? <OptionGrid icon={<Wrench className="h-3.5 w-3.5" />} title="OEM brand (store equipment)" all="All OEM brands" value={f.dims.brand} options={options.brands} onChange={(v) => setF(setDim(f, 'brand', v))} />
              : <div />}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {showPeople
              ? <OptionGrid icon={<User className="h-3.5 w-3.5" />} title="Assigned technician" all="All technicians" value={f.dims.tech} options={options.techs} onChange={(v) => setF(setDim(f, 'tech', v))} search />
              : <div />}
            <div className="space-y-4">
              <OptionGrid icon={<Layers className="h-3.5 w-3.5" />} title="Queue status" all="All statuses" value={f.dims.status} options={options.statuses} onChange={(v) => setF(setDim(f, 'status', v))} presets={STATUS_PRESETS.map((s) => ({ label: s.label, values: s.statuses }))} />
              <OptionGrid icon={<span className="inline-block h-3.5 w-3.5" />} title="Priority" all="All priorities" value={f.dims.prio} options={options.prios} onChange={(v) => setF(setDim(f, 'prio', v))} />
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" />SLA state</p>
                <div className="flex flex-wrap gap-1.5">
                  {SLA_OPTIONS.map((o) => <button key={o.value} type="button" onClick={() => setF({ ...f, sla: o.value })} className={pill(f.sla === o.value)}>{o.label.replace('SLA: ', '')}</button>)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-6 py-3.5">
          <button type="button" onClick={() => { setF(emptyFilters()); setPer('30d') }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10"><RotateCcw className="h-3.5 w-3.5" />Clear everything</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">Cancel</button>
            <button type="button" disabled={per === 'custom' && !validRange} onClick={() => onApply(f, per, { start, end })} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Apply filters</button>
          </div>
        </div>
      </div>
    </div>
  )
}
