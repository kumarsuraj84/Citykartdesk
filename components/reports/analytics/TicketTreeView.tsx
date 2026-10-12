'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { STATUS_LABELS } from '@/lib/constants/requests'
import {
  flattenTree, collapsedForTreeLevel, treeLevelOf, treeColumns, treeCell, groupByLabel,
  type TicketTree, type TreeCollapsed, type TreeGroupBy, type TreeLevel, type TreeToggle,
} from '@/lib/reporting/analytics/ticket-tree'
import { ExportTicketTreeButton, type TreeExportProps } from './ExportTicketTreeButton'

const LEVELS: { value: TreeLevel; label: (g: string) => string }[] = [
  { value: 'groups', label: (g) => g },
  { value: 'stores', label: () => '+ Stores' },
  { value: 'tickets', label: () => '+ Tickets' },
]

// Same look as the age summary: the table scrolls inside its own box, the heading row stays on top, and on
// wide screens the first two columns (the heading and the store) stay at the left while the rest scrolls.
// Frozen cells are solid, widths are fixed so the second frozen column's left offset is exact. Tailwind
// classes are written out in full so they are generated.
const W = { group: 160, store: 120, bucket: 84, grand: 96 }
const COL_PX: Record<string, number> = { category: 170, subCategory: 190, subject: 280, ticketNo: 110, technician: 140, oem: 170, status: 110, createdDate: 100, ageDays: 80 }
const FROZEN = 'md:sticky md:z-[5]'
const FROZEN_BG = {
  ticket: 'bg-card group-hover:bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]',
  group: 'bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]',
  total: 'bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]',
  grand: 'bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))]',
}
const TH = 'sticky top-0 z-10 bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide'

/**
 * The group → store → ticket table, pivot-style: every heading and store has a ▸/▾ arrow to fold it into one
 * line of totals or open it again, and the level buttons fold everything at once. Export to Excel follows
 * exactly what is on screen.
 */
export function TicketTreeView({ tree, groupBy, oemAvailable, defaultLevel, exportProps }: {
  tree: TicketTree
  groupBy: TreeGroupBy
  /** false when no chosen service goes to an OEM: there is no OEM column */
  oemAvailable: boolean
  defaultLevel: TreeLevel
  exportProps: TreeExportProps
}) {
  const [collapsed, setCollapsed] = useState<TreeCollapsed>(() => collapsedForTreeLevel(tree, defaultLevel))
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed])
  const level = treeLevelOf(tree, collapsed)
  const cols = treeColumns(groupBy, oemAvailable)
  const { buckets, grand } = tree
  const heading = groupByLabel(groupBy)
  const statusLabel = (s: string) => (STATUS_LABELS as Record<string, string>)[s] ?? s

  function toggle(t: TreeToggle) {
    setCollapsed((prev) => {
      const set = new Set(t.type === 'group' ? prev.group : prev.store)
      if (t.expanded) set.add(t.key); else set.delete(t.key)
      return t.type === 'group' ? { group: set, store: prev.store } : { group: prev.group, store: set }
    })
  }

  const exportButton = <ExportTicketTreeButton {...exportProps} collapsedGroups={[...collapsed.group]} collapsedStores={[...collapsed.store]} />
  const num = 'px-3 py-2 text-right text-[12px] tabular-nums'
  const show = (n: number | undefined) => (n ? n : '')
  const tableWidth = W.group + W.store + cols.reduce((a, c) => a + COL_PX[c.key], 0) + buckets.length * W.bucket + W.grand

  const Arrow = ({ t, label }: { t: TreeToggle; label: string }) => (
    <button
      type="button"
      onClick={() => toggle(t)}
      aria-label={`${t.expanded ? 'Collapse' : 'Expand'} ${label}`}
      aria-expanded={!t.expanded}
      className="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {t.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </button>
  )

  if (tree.groups.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{exportButton}</div>
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No tickets match these filters</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a wider date range, include more statuses or services, or lower the number of tickets per store.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Show</span>
          <div className="flex gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="Level of detail">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setCollapsed(collapsedForTreeLevel(tree, l.value))}
                aria-pressed={level === l.value}
                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${level === l.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {l.label(heading)}
              </button>
            ))}
          </div>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">or use the arrows to open or close one row</span>
        </div>
        {exportButton}
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: W.group }} /><col style={{ width: W.store }} />
            {cols.map((c) => <col key={c.key} style={{ width: COL_PX[c.key] }} />)}
            {buckets.map((b) => <col key={b} style={{ width: W.bucket }} />)}
            <col style={{ width: W.grand }} />
          </colgroup>
          <thead>
            <tr className="text-primary-foreground">
              <th className={`${TH} md:z-30 md:left-0 text-left`}>{heading}</th>
              <th className={`${TH} md:z-30 md:left-[160px] text-left border-r border-primary-foreground/30`}>Store</th>
              {cols.map((c) => <th key={c.key} className={`${TH} text-left whitespace-nowrap ${c.numeric ? 'text-center' : ''}`}>{c.label}</th>)}
              {buckets.map((b) => <th key={b} className={`${TH} text-right whitespace-nowrap`}>{b}</th>)}
              <th className={`${TH} text-right whitespace-nowrap`}>Grand Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isTotal = r.kind === 'groupTotal'
              const isGroup = r.kind === 'group'
              const bg = isTotal ? FROZEN_BG.total : isGroup || r.kind === 'store' ? FROZEN_BG.group : FROZEN_BG.ticket
              const rowTone = isTotal
                ? 'border-t border-border bg-muted/50 font-semibold'
                : isGroup ? 'border-t border-border bg-muted/30 font-semibold'
                : r.kind === 'store' ? 'border-t border-border/60 bg-muted/30'
                : 'border-t border-border/60 hover:bg-muted/30'
              return (
                <tr key={r.key} className={`group ${rowTone}`}>
                  <td className={`${FROZEN} md:left-0 ${bg} px-3 py-2 align-top text-[12px] font-semibold text-foreground break-words`} colSpan={isTotal ? 2 : 1}>
                    <span className="inline-flex items-center">
                      {r.groupToggle && <Arrow t={r.groupToggle} label={r.groupToggle.key} />}
                      {r.groupLabel}
                    </span>
                  </td>
                  {!isTotal && (
                    <td className={`${FROZEN} md:left-[160px] ${bg} border-r border-border/70 px-3 py-2 align-top text-[12px] text-foreground break-words`}>
                      <span className="inline-flex items-center">
                        {r.storeToggle && <Arrow t={r.storeToggle} label={r.storeLabel} />}
                        {r.storeLabel}
                      </span>
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 align-top text-[12px] break-words ${c.numeric ? 'text-center tabular-nums' : ''}`}>
                      {r.ticket && (c.key === 'ticketNo'
                        ? <Link href={`/requests/${r.ticket.id}?from=%2Frequests%2Fqueue`} className="font-mono text-[11px] font-semibold text-primary hover:underline">{r.ticket.ticketNo}</Link>
                        : treeCell(r.ticket, c.key, statusLabel))}
                    </td>
                  ))}
                  {buckets.map((b) => <td key={b} className={`${num} align-top`}>{show(r.counts[b])}</td>)}
                  <td className={`${num} align-top font-semibold`}>{r.total || ''}</td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-primary/40 bg-primary/10 font-bold">
              <td className={`${FROZEN} md:left-0 ${FROZEN_BG.grand} border-r border-border/70 px-3 py-2 text-[12px]`} colSpan={2}>Grand Total</td>
              {cols.map((c) => <td key={c.key} />)}
              {buckets.map((b) => <td key={b} className={num}>{show(grand.counts[b])}</td>)}
              <td className={num}>{grand.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
