'use client'

import { useState } from 'react'
import { Flag, Store } from 'lucide-react'
import type { PlaceKey, StoreSection, PeriodParam } from '@/lib/queries/analytics'
import type { DrawerFilter } from '@/lib/actions/analytics'
import { storeFilterCount } from '@/lib/analytics/store-filter'

const PLACES: { key: PlaceKey; label: string }[] = [
  { key: 'region', label: 'Region' },
  { key: 'state', label: 'State' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'stype', label: 'Store type' },
  { key: 'plist', label: 'Store priority list as per Ops' },
]

/**
 * The Store Master view of the Requests tab: tickets region wise, state wise, cluster wise (or by store type / priority list), the stores that are
 * above the AC red-flag limit, and the new stores. It follows every choice made on the page (groups, dates, store filters). A row opens the list of
 * its tickets, narrowed by the store choices already made.
 */
export function StoreMasterWidget({ stores, period, onOpen }: {
  stores: StoreSection; period: PeriodParam; onOpen: (f: DrawerFilter) => void
}) {
  const [key, setKey] = useState<PlaceKey>('region')
  const rows = stores.places[key]
  const s = stores.summary
  const maxCreated = Math.max(1, ...rows.map((r) => r.created))

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Stores &amp; regions</h2>
          {storeFilterCount(stores.filter) > 0 && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">store filters on</span>}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Show by
          <select
            aria-label="Store breakdown field" value={key} onChange={(e) => setKey(e.target.value as PlaceKey)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground"
          >
            {PLACES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">Stores with tickets</p>
          <p className="mt-0.5 text-base font-bold tabular-nums">{s.storesWithTickets}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">Red flag stores</p>
          <p className={`mt-0.5 text-base font-bold tabular-nums ${s.redFlagCount > 0 ? 'text-red-600' : ''}`}>{s.redFlagCount}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">New store (NSO) tickets</p>
          <p className="mt-0.5 text-base font-bold tabular-nums">{s.nsoTickets}</p>
          <p className="text-[10px] text-muted-foreground">{s.nsoStores} store{s.nsoStores === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {[PLACES.find((p) => p.key === key)!.label, 'Created', 'Resolved', 'Open now', 'Breached now', 'SLA %'].map((h) => (
                <th key={h} className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground last:pr-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-4 text-xs text-muted-foreground">No tickets for this selection.</td></tr>}
            {rows.map((r) => {
              const sla = r.slaRate === null ? '' : r.slaRate >= 90 ? 'text-green-600' : r.slaRate >= 75 ? 'text-amber-600' : 'text-red-600'
              const clickable = r.name !== '(No store)'
              return (
                <tr
                  key={r.name}
                  onClick={clickable ? () => onOpen({
                    title: `${PLACES.find((p) => p.key === key)!.label}: ${r.name}`,
                    description: `Requests created in the selected period from ${r.name}`,
                    createdInPeriod: true, period,
                    store: { ...stores.filter, [key]: [r.name] },
                  }) : undefined}
                  className={`border-b border-border/50 last:border-0 ${clickable ? 'cursor-pointer transition-colors hover:bg-muted/40' : ''}`}
                >
                  <td className="py-2.5 pr-4 font-medium">{r.name}</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    <div className="flex items-center gap-2">
                      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted md:block"><div className="h-full rounded-full bg-foreground/60" style={{ width: `${(r.created / maxCreated) * 100}%` }} /></div>
                      {r.created}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums">{r.resolved}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{r.openNow}</td>
                  <td className={`py-2.5 pr-4 tabular-nums ${r.breachedNow > 0 ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>{r.breachedNow}</td>
                  <td className={`py-2.5 tabular-nums font-semibold ${sla}`}>{r.slaRate !== null ? `${r.slaRate}%` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {s.redFlagStores.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-red-200/60 bg-red-50/40 p-3 dark:border-red-900/40 dark:bg-red-950/20">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
            <Flag className="h-3.5 w-3.5" />Red flag stores (AC Not Working % above 30%)
          </p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {s.redFlagStores.map((r) => (
              <li key={r.code} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate"><span className="font-semibold">{r.code}</span> <span className="text-muted-foreground">{r.cluster} · {r.region}</span></span>
                <span className="shrink-0 tabular-nums font-semibold text-red-700 dark:text-red-400">{Math.round(r.acPct ?? 0)}% <span className="font-normal text-muted-foreground">({r.acOpen}/{r.acTotal})</span></span>
              </li>
            ))}
          </ul>
          {s.redFlagCount > s.redFlagStores.length && <p className="text-[11px] text-muted-foreground">and {s.redFlagCount - s.redFlagStores.length} more</p>}
        </div>
      )}
    </div>
  )
}
