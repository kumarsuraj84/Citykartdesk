'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import {
  DIM_LABEL, UNASSIGNED, applyFilters, compare, compareRows, formatMeasure, keyOf, statusLabel, type Dim, type Measure,
} from '@/lib/reporting/executive/engine'
import { dimsForLevel } from '@/lib/reporting/executive/levels'
import type { DashData, OpenDrill } from './types'
import { Chev, DeltaBadge, Panel, PanelTitle, Seg, SlaPercent } from './ui'

const COLS: Measure[] = ['created', 'resolved', 'backlog', 'breaches', 'sla', 'tat', 'frt', 'reopened', 'csat']
const HEAD: Record<Measure, string> = { created: 'Created', resolved: 'Resolved', backlog: 'Backlog', breaches: 'Breaches', sla: 'SLA', tat: 'Resolution', frt: 'Response', reopened: 'Re-opened', csat: 'CSAT' }
const SHOW = 12

function topOf<T>(items: T[], key: (t: T) => string, n: number): string[] {
  const c = new Map<string, number>()
  for (const i of items) c.set(key(i), (c.get(key(i)) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0])
}

/** One comparison table: every measure for each value of a dimension, sortable, with a risk-tinted row when SLA is low. */
function Matrix({ d, onOpen, title, caption, dims, defaultDim }: {
  d: DashData; onOpen: OpenDrill; title: string; caption: string; dims: Dim[]; defaultDim: Dim
}) {
  const { tickets, filters, now, W, P, compareOn } = d
  const [dim, setDim] = useState<Dim>(dims.includes(defaultDim) ? defaultDim : dims[0])
  const [sort, setSort] = useState<{ k: Measure | 'key'; dir: 1 | -1 }>({ k: 'created', dir: -1 })
  const [all, setAll] = useState(false)

  const rows = useMemo(() => {
    const r = compareRows(tickets, filters, dim, W, P, now)
    const { k, dir } = sort
    return r.sort((a, b) => {
      if (k === 'key') return dir * a.key.localeCompare(b.key)
      const x = a[k]; const y = b[k]
      if (x === null) return 1
      if (y === null) return -1
      return dir * (x - y)
    })
  }, [tickets, filters, dim, W, P, now, sort])
  const shown = all ? rows : rows.slice(0, SHOW)
  const sub = useMemo(() => {
    if (dim !== 'group' && dim !== 'brand' && dim !== 'oem') return new Map<string, string>()
    const base = applyFilters(tickets, filters, now, [dim])
    const out = new Map<string, string>()
    for (const r of shown) {
      const mine = base.filter((t) => keyOf(dim, t, now) === r.key)
      out.set(r.key, dim === 'group'
        ? topOf(mine.filter((t) => t.tech !== UNASSIGNED), (t) => t.tech, 1).join('')
        : topOf(mine, (t) => t.store, 2).join(', '))
    }
    return out
  }, [dim, tickets, filters, now, shown])
  const maxCreated = Math.max(1, ...rows.map((r) => r.created ?? 0))
  const maxBacklog = Math.max(1, ...rows.map((r) => r.backlog ?? 0))
  const maxBreach = Math.max(1, ...rows.map((r) => r.breaches ?? 0))

  const onSort = (k: Measure | 'key') => setSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: k === 'key' ? 1 : -1 }))
  const head = (k: Measure | 'key', label: string, right = true) => (
    <th key={k} className={`py-3 ${right ? 'px-3 text-right' : 'pl-5 pr-3 text-left'}`}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${sort.k === k ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
        {label}{sort.k === k ? (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  )
  const open = (key: string) => onOpen({
    title: `${DIM_LABEL[dim]}: ${key}`, subtitle: `Stores, technicians and tickets for ${key}`, stage: dim === 'tech' || dim === 'store' ? 3 : 2, metric: 'created', dims: { [dim]: key },
  })

  return (
    <Panel className="overflow-hidden !p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <PanelTitle title={title} caption={caption} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">Compare by
          <select aria-label={`${title} dimension`} value={dim} onChange={(e) => { setDim(e.target.value as Dim); setAll(false) }} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            {dims.map((x) => <option key={x} value={x}>{DIM_LABEL[x]}</option>)}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {head('key', DIM_LABEL[dim], false)}
              {COLS.map((k) => head(k, HEAD[k]))}
              <th className="w-10 py-3 pl-2 pr-5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-xs">
            {shown.map((r) => {
              const risky = r.sla !== null && r.sla <= 25
              return (
                <tr key={r.key} onClick={() => open(r.key)} className={`group cursor-pointer transition-colors ${risky ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50'}`}>
                  <td className="whitespace-nowrap py-3 pl-5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="max-w-[16rem] truncate font-semibold text-foreground" title={r.key}>{statusLabel(r.key)}</span>
                      {sub.get(r.key) && <span className="hidden max-w-[14rem] truncate text-[11px] text-muted-foreground sm:inline">· {sub.get(r.key)}</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    <div className="inline-flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted md:block"><div className="h-full rounded-full bg-foreground/60" style={{ width: `${((r.created ?? 0) / maxCreated) * 100}%` }} /></div>
                      <span className="font-semibold text-foreground">{r.created}</span>
                      {compareOn && <DeltaBadge d={compare('created', r.created, r.prev_created)} className="!text-[10px]" />}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><span className={(r.resolved ?? 0) > 0 ? 'font-semibold text-success' : 'text-muted-foreground'}>{r.resolved}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><span className={(r.backlog ?? 0) >= maxBacklog * 0.6 && maxBacklog >= 5 ? 'font-bold text-warning' : (r.backlog ?? 0) > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}>{r.backlog}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><span className={(r.breaches ?? 0) >= maxBreach * 0.6 && maxBreach >= 5 ? 'font-bold text-destructive' : (r.breaches ?? 0) > 0 ? 'font-medium text-destructive/80' : 'text-muted-foreground'}>{r.breaches}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><SlaPercent value={r.sla} /></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">{formatMeasure('tat', r.tat)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">{formatMeasure('frt', r.frt)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><span className={(r.reopened ?? 0) > 0 ? 'font-semibold text-warning' : 'text-muted-foreground'}>{r.reopened}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">{formatMeasure('csat', r.csat)}</td>
                  <td className="py-3 pl-2 pr-5 text-right"><Chev className="inline-block h-4 w-4" /></td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={COLS.length + 2} className="py-8 text-center text-xs text-muted-foreground">Nothing to compare for this selection.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > SHOW && (
        <div className="border-t border-border px-5 py-2.5">
          <button type="button" onClick={() => setAll(!all)} className="text-xs font-semibold text-primary hover:underline">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
        </div>
      )}
    </Panel>
  )
}

export function MatricesSection({ d, onOpen }: { d: DashData; onOpen: OpenDrill }) {
  const [layout, setLayout] = useState<'both' | 'group' | 'oem'>('both')
  const all = dimsForLevel(d.level)
  const groupDims = (['group', 'tech', 'cat', 'sub', 'svc', 'dept', 'req', 'src', 'prio'] as Dim[]).filter((x) => all.includes(x))
  const oemDims = (['brand', 'oem', 'store', 'state', 'loc'] as Dim[]).filter((x) => all.includes(x))
  return (
    <section id="matrices-section" aria-label="Group and OEM comparison" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comparative performance matrices (group &amp; store OEM)</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Red tint = SLA compliance at 25% or lower. Click a column to sort, a row to open its drill-down.</p>
        </div>
        <Seg value={layout} onChange={setLayout} label="Matrices" tone="strong" options={[{ value: 'both', label: 'Both matrices' }, { value: 'group', label: 'By group' }, { value: 'oem', label: 'By OEM brand' }]} />
      </div>
      {(layout === 'both' || layout === 'group') && (
        <Matrix d={d} onOpen={onOpen} title="Compare side by side" caption="Every measure for each value of the field you pick, with the change vs the previous period." dims={groupDims} defaultDim={d.level === 'requester' ? 'cat' : 'group'} />
      )}
      {(layout === 'both' || layout === 'oem') && oemDims.length > 0 && (
        <Matrix d={d} onOpen={onOpen} title="OEM-wise tickets - store equipment" caption="Tickets by OEM (from the requester's store): for example the AC issues of each OEM brand. Switch to OEM, store or state." dims={oemDims} defaultDim="brand" />
      )}
    </section>
  )
}
