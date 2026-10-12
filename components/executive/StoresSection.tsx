'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Flag } from 'lucide-react'
import { NOT_SET, applyFilters, compareRows, inWin, type CompareRow, type ExecTicket } from '@/lib/reporting/executive/engine'
import { DEFAULT_RED_FLAG_PERCENT as RED_FLAG_LIMIT } from '@/lib/reporting/analytics/facts'
import type { DashData, OpenDrill } from './types'
import { Matrix } from './MatricesSection'
import { Chev, Panel, PanelTitle, SlaPercent } from './ui'

const SHOW = 15

interface StoreRow {
  store: string
  cluster: string
  region: string
  stype: string
  created: number
  backlog: number
  breaches: number
  sla: number | null
  acTotal: number | null
  acOpen: number
  acPct: number | null
}

type SortKey = 'store' | 'created' | 'backlog' | 'breaches' | 'sla' | 'acPct'

/** The first ticket of each store: every ticket of a store carries the same Store Master details and AC position. */
function storeDetails(tickets: ExecTicket[]): Map<string, ExecTicket> {
  const m = new Map<string, ExecTicket>()
  for (const t of tickets) if (!m.has(t.store)) m.set(t.store, t)
  return m
}

/**
 * Where tickets come from: region, state and cluster side by side (the same measures as the other comparisons), and the stores one by
 * one with their cluster, region, type (new store or regular) and the AC position from the Store Master. Everything follows the
 * dashboard's filters and period, and a click opens the drill-down.
 */
export function StoresSection({ d, onOpen }: { d: DashData; onOpen: OpenDrill }) {
  const { tickets, filters, now, W, P } = d
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'backlog', dir: -1 })
  const [all, setAll] = useState(false)
  const [redOnly, setRedOnly] = useState(false)

  const base = useMemo(() => applyFilters(tickets, filters, now), [tickets, filters, now])
  // the tickets raised in the chosen period by a store (head office staff have no store)
  const fromStores = useMemo(() => base.filter((t) => inWin(t.created, W) && t.stype !== NOT_SET), [base, W])
  const rows: StoreRow[] = useMemo(() => {
    const details = storeDetails(base)
    return compareRows(tickets, filters, 'store', W, P, now)
      .filter((r: CompareRow) => details.get(r.key)?.stype !== undefined && details.get(r.key)?.stype !== NOT_SET && ((r.created ?? 0) > 0 || (r.backlog ?? 0) > 0))
      .map((r) => {
        const t = details.get(r.key)
        return {
          store: r.key, cluster: t?.cluster ?? NOT_SET, region: t?.region ?? NOT_SET, stype: t?.stype ?? NOT_SET,
          created: r.created ?? 0, backlog: r.backlog ?? 0, breaches: r.breaches ?? 0, sla: r.sla,
          acTotal: t?.acTotal ?? null, acOpen: t?.acOpen ?? 0, acPct: t?.acPct ?? null,
        }
      })
  }, [tickets, filters, base, W, P, now])

  const redFlag = (r: StoreRow) => r.acPct !== null && r.acPct > RED_FLAG_LIMIT
  const shownRows = useMemo(() => {
    const { k, dir } = sort
    const list = redOnly ? rows.filter(redFlag) : rows
    return [...list].sort((a, b) => {
      if (k === 'store') return dir * a.store.localeCompare(b.store, undefined, { numeric: true })
      const x = a[k]; const y = b[k]
      if (x === null) return 1
      if (y === null) return -1
      return dir * (x - y)
    })
  }, [rows, sort, redOnly])
  const visible = all ? shownRows : shownRows.slice(0, SHOW)

  const redStores = rows.filter(redFlag)
  const nsoTickets = fromStores.filter((t) => t.stype === 'NSO').length
  const missing = rows.filter((r) => r.cluster === NOT_SET || r.region === NOT_SET).length
  const hasAc = rows.some((r) => r.acTotal !== null)

  const onSort = (k: SortKey) => setSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: k === 'store' ? 1 : -1 }))
  const head = (k: SortKey, label: string, right = true) => (
    <th key={k} className={`py-3 ${right ? 'px-3 text-right' : 'pl-5 pr-3 text-left'}`}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${sort.k === k ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
        {label}{sort.k === k ? (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  )
  const openStore = (r: StoreRow) => onOpen({ title: `Store: ${r.store}`, subtitle: `${[r.cluster, r.region].filter((x) => x !== NOT_SET).join(' · ') || 'Tickets raised by this store'}`, stage: 3, metric: 'created', dims: { store: r.store } })

  return (
    <section id="stores-section" aria-label="Stores and regions" className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stores &amp; regions</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Where the tickets come from: region, state and cluster side by side, and each store with its AC position (Store Master). Every list follows the filters above.</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: 'Stores with tickets', value: rows.length, note: `${fromStores.length} ticket${fromStores.length === 1 ? '' : 's'} from stores in this period`, tone: 'text-foreground' },
          { label: 'Red flag stores', value: hasAc ? redStores.length : '-', note: hasAc ? `AC Not Working % above ${RED_FLAG_LIMIT}%` : 'No AC data yet', tone: redStores.length > 0 ? 'text-destructive' : 'text-foreground' },
          { label: 'New stores (NSO)', value: nsoTickets, note: 'tickets in this period from stores opened in the last 9 months, or with no open date', tone: 'text-foreground' },
          { label: 'Store details missing', value: missing, note: missing > 0 ? 'stores without a cluster or region' : 'all stores have them', tone: missing > 0 ? 'text-warning' : 'text-success' },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${c.tone}`}>{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.note}</div>
          </div>
        ))}
      </div>

      <Matrix
        d={d} onOpen={onOpen} title="Region, state and cluster wise" dims={['region', 'state', 'cluster', 'stype', 'plist']} defaultDim="region"
        caption="Every measure for each region, state, cluster, store type or priority list. Switch the field above the table; click a row to open its drill-down."
      />

      <Panel>
        <PanelTitle
          title="Store by store"
          caption={`${shownRows.length} store${shownRows.length === 1 ? '' : 's'}${redOnly ? ' with a red flag' : ''} · click a column to sort, a row to open the store`}
          right={hasAc ? (
            <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50">
              <input type="checkbox" checked={redOnly} onChange={(e) => setRedOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
              Red flag stores only
            </label>
          ) : undefined}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {head('store', 'Store', false)}
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cluster</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Region</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                {head('created', 'Created')}
                {head('backlog', 'Backlog')}
                {head('breaches', 'Breaches')}
                {head('sla', 'SLA')}
                {head('acPct', 'AC not working')}
                <th className="w-10 py-3 pl-2 pr-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {visible.map((r) => {
                const red = redFlag(r)
                return (
                  <tr key={r.store} onClick={() => openStore(r)} className={`group cursor-pointer transition-colors ${red ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50'}`}>
                    <td className="whitespace-nowrap py-3 pl-5 pr-3 font-semibold text-foreground">{r.store}</td>
                    <td className="px-3 py-3 text-muted-foreground">{r.cluster}</td>
                    <td className="px-3 py-3 text-muted-foreground">{r.region}</td>
                    <td className="px-3 py-3">{r.stype === 'NSO' ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">NSO</span> : <span className="text-muted-foreground">{r.stype === NOT_SET ? '' : r.stype}</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-foreground">{r.created}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground">{r.backlog}</td>
                    <td className="px-3 py-3 text-right tabular-nums"><span className={r.breaches > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}>{r.breaches}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums"><SlaPercent value={r.sla} /></td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {r.acPct === null ? <span className="text-muted-foreground">-</span> : (
                        <span className={red ? 'inline-flex items-center gap-1 font-semibold text-destructive' : 'text-foreground'} title={`${r.acOpen} open AC ticket${r.acOpen === 1 ? '' : 's'} of ${r.acTotal} ACs`}>
                          {red && <Flag className="h-3 w-3" />}{Math.round(r.acPct)}% <span className="text-[11px] font-normal text-muted-foreground">({r.acOpen}/{r.acTotal})</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 pl-2 pr-5 text-right"><Chev className="inline-block h-4 w-4" /></td>
                  </tr>
                )
              })}
              {visible.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-xs text-muted-foreground">{redOnly ? 'No store is above the red flag limit.' : 'No stores in this selection.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {shownRows.length > SHOW && (
          <div className="border-t border-border px-5 py-2.5">
            <button type="button" onClick={() => setAll(!all)} className="text-xs font-semibold text-primary hover:underline">{all ? 'Show fewer' : `Show all ${shownRows.length}`}</button>
          </div>
        )}
      </Panel>
    </section>
  )
}
