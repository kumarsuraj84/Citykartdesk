'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Flag } from 'lucide-react'
import { flattenStoreAc, pctText, STORE_AC_GROUPS, STORE_AC_COLUMNS, type StoreAcGroupBy, type StoreAcReport } from '@/lib/reporting/analytics/store-ac'
import { ExportStoreAcButton, type StoreAcExportProps } from './ExportStoreAcButton'

const COL_W = [90, 160, 80, 70, 150, 100, 120, 80, 100, 120, 80, 80]
const GROUP_W = 160
const BUCKET_W = 84
const GRAND_W = 96
const TH = 'sticky top-0 z-10 bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide'
const FROZEN = 'md:sticky md:z-[5]'

/**
 * The Store AC Not Working table: each group (cluster, region ...) can be folded to one line with its AC total, open AC tickets
 * and AC Not Working %; stores above the red-flag limit are marked. Export to Excel follows what is on screen.
 */
export function StoreAcView({ report, groupBy, redFlagPercent, defaultCollapsed, exportProps }: {
  report: StoreAcReport
  groupBy: StoreAcGroupBy
  redFlagPercent: number
  /** open at the stores, or closed to one line per group */
  defaultCollapsed: boolean
  exportProps: StoreAcExportProps
}) {
  const grouped = groupBy !== 'none'
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => (defaultCollapsed ? new Set(report.groups.map((g) => g.key)) : new Set()))
  const rows = useMemo(() => flattenStoreAc(report, collapsed, groupBy), [report, collapsed, groupBy])
  const { buckets, grand } = report
  const allClosed = report.groups.length > 0 && report.groups.every((g) => collapsed.has(g.key))
  const allOpen = collapsed.size === 0
  const groupLabel = STORE_AC_GROUPS.find((g) => g.value === groupBy)?.label ?? ''

  const exportButton = <ExportStoreAcButton {...exportProps} collapsed={[...collapsed]} />
  const num = 'px-3 py-2 text-right text-[12px] tabular-nums'
  const show = (n: number | undefined) => (n ? n : '')
  const lead = grouped ? GROUP_W : 0
  const tableWidth = lead + COL_W.reduce((a, b) => a + b, 0) + buckets.length * BUCKET_W + GRAND_W
  const storeLeft = lead

  function toggle(key: string) {
    setCollapsed((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }

  if (report.groups.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{exportButton}</div>
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No stores match these filters</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a wider date range, include more statuses, or clear a filter. Only tickets of AC services are counted.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {grouped && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Show</span>
              <div className="flex gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="Level of detail">
                <button type="button" aria-pressed={allClosed} onClick={() => setCollapsed(new Set(report.groups.map((g) => g.key)))}
                  className={`rounded-md px-3 py-1 text-[11px] font-semibold ${allClosed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{groupLabel}</button>
                <button type="button" aria-pressed={allOpen} onClick={() => setCollapsed(new Set())}
                  className={`rounded-md px-3 py-1 text-[11px] font-semibold ${allOpen ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>+ Stores</button>
              </div>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">or use the arrows</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{grand.stores}</span> store{grand.stores === 1 ? '' : 's'}
            {' · '}<span className="font-semibold text-red-600">{grand.redFlagStores}</span> red flag (above {redFlagPercent}%)
            {grand.pct != null && <> · overall <span className="font-semibold text-foreground">{pctText(grand.pct)}</span> of ACs have an open ticket</>}
          </p>
        </div>
        {exportButton}
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
          <colgroup>
            {grouped && <col style={{ width: GROUP_W }} />}
            {COL_W.map((w, i) => <col key={i} style={{ width: w }} />)}
            {buckets.map((b) => <col key={b} style={{ width: BUCKET_W }} />)}
            <col style={{ width: GRAND_W }} />
          </colgroup>
          <thead>
            <tr className="text-primary-foreground">
              {grouped && <th className={`${TH} md:sticky md:z-30 text-left`} style={{ left: 0 }}>{groupLabel}</th>}
              {STORE_AC_COLUMNS.map((c, i) => (
                <th key={c} style={i === 0 ? { left: storeLeft } : undefined} className={`${TH} whitespace-nowrap ${i === 0 ? 'md:sticky md:z-30 text-left border-r border-primary-foreground/30' : i >= 7 ? 'text-center' : 'text-left'}`}>{c}</th>
              ))}
              {buckets.map((b) => <th key={b} className={`${TH} text-right whitespace-nowrap`}>{b}</th>)}
              <th className={`${TH} text-right whitespace-nowrap`}>Grand Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (r.kind === 'group') {
                const g = r.group
                return (
                  <tr key={r.key} className="border-t border-border bg-muted/30 font-semibold">
                    <td className={`${FROZEN} bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))] px-3 py-2 text-[12px] text-foreground`} style={{ left: 0 }}>
                      <span className="inline-flex items-center">
                        <button type="button" onClick={() => toggle(g.key)} aria-label={`${r.expanded ? 'Collapse' : 'Expand'} ${g.name}`} aria-expanded={r.expanded}
                          className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                          {r.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        {g.name}
                      </span>
                    </td>
                    <td className={`${FROZEN} border-r border-border/70 bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))] px-3 py-2 text-[12px] text-muted-foreground`} style={{ left: storeLeft }}>{g.stores.length} stores</td>
                    <td colSpan={6} />
                    <td className={`${num} text-center`}>{g.acTotal || ''}</td>
                    <td className={`${num} text-center`}>{g.openAcTickets || ''}</td>
                    <td className={`${num} text-center`}>{pctText(g.pct)}</td>
                    <td colSpan={2} />
                    {buckets.map((b) => <td key={b} className={num}>{show(g.counts[b])}</td>)}
                    <td className={`${num} font-semibold`}>{g.total}</td>
                  </tr>
                )
              }
              const s = r.store!
              const red = s.redFlag
              return (
                <tr key={r.key} className={`group border-t border-border/60 ${red ? 'bg-red-50/60 dark:bg-red-950/20' : 'hover:bg-muted/30'}`}>
                  {grouped && <td className={`${FROZEN} ${red ? 'bg-red-50 dark:bg-red-950/40' : 'bg-card'}`} style={{ left: 0 }} />}
                  <td className={`${FROZEN} border-r border-border/70 px-3 py-2 text-[12px] font-semibold ${red ? 'bg-red-50 dark:bg-red-950/40' : 'bg-card group-hover:bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]'}`} style={{ left: storeLeft }}>{s.store}</td>
                  <td className="px-3 py-2 text-[12px] break-words">{s.city}</td>
                  <td className="px-3 py-2 text-[12px]">{s.cluster}</td>
                  <td className="px-3 py-2 text-[12px]">{s.region}</td>
                  <td className="px-3 py-2 text-[12px]">{s.priorityList}</td>
                  <td className="px-3 py-2 text-[12px] break-words">{s.acBrand}</td>
                  <td className="px-3 py-2 text-[12px] break-words">{s.acAmcBrand}</td>
                  <td className={`${num} text-center`}>{s.acTotal ?? ''}</td>
                  <td className={`${num} text-center`}>{s.openAcTickets}</td>
                  <td className={`${num} text-center font-semibold ${red ? 'text-red-600' : ''}`}>{pctText(s.pct)}</td>
                  <td className="px-3 py-2 text-center text-[12px]">{red ? <span className="inline-flex items-center gap-1 font-semibold text-red-600"><Flag className="h-3 w-3" /> Red Flag</span> : s.pct == null ? '' : '-'}</td>
                  <td className="px-3 py-2 text-center text-[12px]">{s.zenatix}</td>
                  {buckets.map((b) => <td key={b} className={num}>{show(s.counts[b])}</td>)}
                  <td className={`${num} font-semibold`}>{s.total}</td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-primary/40 bg-primary/10 font-bold">
              <td className={`${FROZEN} bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] border-r border-border/70 px-3 py-2 text-[12px]`} style={{ left: 0 }} colSpan={grouped ? 2 : 1}>Grand Total</td>
              <td colSpan={grouped ? 6 : 6} />
              <td className={`${num} text-center`}>{grand.acTotal || ''}</td>
              <td className={`${num} text-center`}>{grand.openAcTickets || ''}</td>
              <td className={`${num} text-center`}>{pctText(grand.pct)}</td>
              <td colSpan={2} />
              {buckets.map((b) => <td key={b} className={num}>{show(grand.counts[b])}</td>)}
              <td className={num}>{grand.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Open AC tickets are the store’s open tickets of AC services (Server Room AC not counted); every ticket counts, also when two are for the same AC.
        AC Not Working % = open AC tickets ÷ AC total. The age columns count the tickets in this report.
      </p>
    </div>
  )
}
