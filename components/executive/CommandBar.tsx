'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Calendar, Check, ChevronDown, Download, Layers, RotateCcw, ShieldAlert, SlidersHorizontal, User, Wrench, X } from 'lucide-react'
import {
  PERIODS, capitalize, emptyFilters, filterCount, isoDay, parseDay, quickRanges,
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

const one = (f: Filters, d: Dim) => f.dims[d][0] ?? ''
const setOne = (f: Filters, d: Dim, v: string): Filters => ({ ...f, dims: { ...f.dims, [d]: v ? [v] : [] } })

export function CommandBar(p: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [datesOpen, setDatesOpen] = useState(false)
  const active = filterCount(p.filters)
  const customLabel = `${dayLabelYear(parseDay(p.custom.start))} - ${dayLabelYear(parseDay(p.custom.end))}`.replace(/ 20\d\d/g, '')
  const withCount = (label: string, o: Opt[]) => [{ value: '', label }, ...o.map((x) => ({ value: x.value, label: `${x.label} (${x.count})` }))]

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
      <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-2.5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" onClick={() => { setFiltersOpen(true); setDatesOpen(false) }}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors ${active > 0 ? 'bg-primary hover:bg-primary/90' : 'bg-foreground hover:bg-foreground/90'}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
            {active > 0 && <span className="rounded bg-card px-1.5 text-[11px] font-bold tabular-nums text-primary">{active}</span>}
          </button>
          <SelectBox label="Filter by group" value={one(p.filters, 'group')} active={!!one(p.filters, 'group')} onChange={(v) => p.onFilters(setOne(p.filters, 'group', v))} options={withCount(`All groups (${p.options.groups.length})`, p.options.groups)} />
          {p.showPeople && <SelectBox label="Filter by technician" value={one(p.filters, 'tech')} active={!!one(p.filters, 'tech')} onChange={(v) => p.onFilters(setOne(p.filters, 'tech', v))} options={withCount(`All technicians (${p.options.techs.length})`, p.options.techs)} />}
          {p.options.brands.length > 0 && <SelectBox label="Filter by OEM brand" value={one(p.filters, 'brand')} active={!!one(p.filters, 'brand')} onChange={(v) => p.onFilters(setOne(p.filters, 'brand', v))} options={withCount(`All OEM brands (${p.options.brands.length})`, p.options.brands)} />}
          <SelectBox label="Filter by status" value={one(p.filters, 'status')} active={!!one(p.filters, 'status')} onChange={(v) => p.onFilters(setOne(p.filters, 'status', v))} options={withCount('All statuses', p.options.statuses)} />
          <SelectBox label="Filter by SLA" value={p.filters.sla} active={p.filters.sla !== 'all'} tone="danger" onChange={(v) => p.onFilters({ ...p.filters, sla: v as SlaState })} options={SLA_OPTIONS} />
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
          onApply={(f, per, c) => { p.onFilters(f); p.onPeriod(per); if (per === 'custom') p.onCustom(c); setFiltersOpen(false) }}
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

// ── The filters pop-up ─────────────────────────────────────────────────────────────────────────────

function OptionGrid({ icon, title, all, value, options, onPick, search = false }: {
  icon: React.ReactNode; title: string; all: string; value: string; options: Opt[]; onPick: (v: string) => void; search?: boolean
}) {
  const [q, setQ] = useState('')
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options
  const cell = (on: boolean) => `flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border text-foreground hover:bg-muted/60'}`
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{icon}{title}</p>
      {search && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />}
      <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
        <button type="button" onClick={() => onPick('')} className={cell(value === '')}>{all}</button>
        {shown.map((o) => (
          <button key={o.value} type="button" onClick={() => onPick(value === o.value ? '' : o.value)} className={cell(value === o.value)}>
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
              <p className="text-xs text-muted-foreground">Combine group, technician, OEM equipment, queue status, SLA and dates</p>
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

          <div className="grid gap-5 md:grid-cols-2">
            <OptionGrid icon={<Building2 className="h-3.5 w-3.5" />} title="Technician group" all="All groups" value={one(f, 'group')} options={options.groups} onPick={(v) => setF(setOne(f, 'group', v))} />
            {options.brands.length > 0
              ? <OptionGrid icon={<Wrench className="h-3.5 w-3.5" />} title="OEM brand (store equipment)" all="All OEM brands" value={one(f, 'brand')} options={options.brands} onPick={(v) => setF(setOne(f, 'brand', v))} />
              : <div />}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {showPeople
              ? <OptionGrid icon={<User className="h-3.5 w-3.5" />} title="Assigned technician" all="All technicians" value={one(f, 'tech')} options={options.techs} onPick={(v) => setF(setOne(f, 'tech', v))} search />
              : <div />}
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground"><Layers className="h-3.5 w-3.5" />Queue status</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setF(setOne(f, 'status', ''))} className={pill(one(f, 'status') === '')}>All</button>
                  {options.statuses.map((s) => <button key={s.value} type="button" onClick={() => setF(setOne(f, 'status', one(f, 'status') === s.value ? '' : s.value))} className={pill(one(f, 'status') === s.value)}>{s.label} ({s.count})</button>)}
                </div>
              </div>
              <div className="space-y-2">
                <p className="font-semibold uppercase tracking-wider text-muted-foreground">Priority</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setF(setOne(f, 'prio', ''))} className={pill(one(f, 'prio') === '')}>All</button>
                  {options.prios.map((s) => <button key={s.value} type="button" onClick={() => setF(setOne(f, 'prio', one(f, 'prio') === s.value ? '' : s.value))} className={pill(one(f, 'prio') === s.value)}>{s.label} ({s.count})</button>)}
                </div>
              </div>
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

