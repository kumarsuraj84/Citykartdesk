'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { STATUS_LABELS } from '@/lib/constants/requests'
import {
  flattenTree, collapsedForDepth, depthOf, cellValue, COLUMNS, LEVELS,
  type ColumnKey, type TicketTree, type TreeDepth, type TreeToggle,
} from '@/lib/reporting/analytics/ticket-tree'
import { ExportTicketTreeButton, type TreeExportProps } from './ExportTicketTreeButton'

// The table scrolls inside its own box, the heading row stays on top, and on wide screens the first two heading columns stay
// at the left while the rest scrolls. Frozen cells are solid, and widths are fixed so the left offset of the second one is exact.
const LEVEL_W = [150, 130, 120, 110]
const BUCKET_W = 84
const GRAND_W = 96
const px = (chars: number) => chars * 7
const FROZEN = 'md:sticky md:z-[5]'
const FROZEN_BG = {
  ticket: 'bg-card group-hover:bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]',
  node: 'bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]',
  total: 'bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]',
  grand: 'bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))]',
}
const TH = 'sticky top-0 z-10 bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide'

/**
 * The grouped ticket table, pivot-style: every heading and store has a ▸/▾ arrow to fold it into one line of totals or open
 * it again, and the level buttons fold everything at one level at once. Export to Excel follows exactly what is on screen.
 */
export function TicketTreeView({ tree, columns, defaultDepth, exportProps }: {
  tree: TicketTree
  columns: ColumnKey[]
  /** how far the report opens: 'tickets' (all the way) or the number of the level shown as one line each */
  defaultDepth: TreeDepth
  exportProps: TreeExportProps
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => collapsedForDepth(tree, defaultDepth))
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed])
  const depth = depthOf(tree, collapsed)
  const { buckets, grand, levels } = tree
  const statusLabel = (s: string) => (STATUS_LABELS as Record<string, string>)[s] ?? s

  const leftOf = (i: number) => LEVEL_W.slice(0, i).reduce((a, b) => a + b, 0)
  const frozenCount = Math.min(2, levels.length)

  function toggle(t: TreeToggle) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (t.expanded) next.add(t.key); else next.delete(t.key)
      return next
    })
  }

  const exportButton = <ExportTicketTreeButton {...exportProps} collapsed={[...collapsed]} />
  const num = 'px-3 py-2 text-right text-[12px] tabular-nums'
  const show = (n: number | undefined) => (n ? n : '')
  const tableWidth = LEVEL_W.slice(0, levels.length).reduce((a, b) => a + b, 0) + columns.reduce((a, c) => a + px(COLUMNS[c].width), 0) + buckets.length * BUCKET_W + GRAND_W

  const Arrow = ({ t }: { t: TreeToggle }) => (
    <button
      type="button"
      onClick={() => toggle(t)}
      aria-label={`${t.expanded ? 'Collapse' : 'Expand'} ${t.name}`}
      aria-expanded={t.expanded}
      className="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {t.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </button>
  )

  if (tree.roots.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{exportButton}</div>
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No tickets match these filters</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a wider date range, include more statuses or services, or clear a filter.</p>
        </div>
      </div>
    )
  }

  const levelButtons: { value: TreeDepth; label: string }[] = [
    ...levels.map((l, i) => ({ value: i as TreeDepth, label: i === 0 ? LEVELS[l].label : `+ ${LEVELS[l].label}` })),
    { value: 'tickets', label: '+ Tickets' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Show</span>
          <div className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="Level of detail">
            {levelButtons.map((l) => (
              <button
                key={String(l.value)}
                type="button"
                onClick={() => setCollapsed(collapsedForDepth(tree, l.value))}
                aria-pressed={depth === l.value}
                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${depth === l.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {l.label}
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
            {levels.map((_, i) => <col key={i} style={{ width: LEVEL_W[i] }} />)}
            {columns.map((c) => <col key={c} style={{ width: px(COLUMNS[c].width) }} />)}
            {buckets.map((b) => <col key={b} style={{ width: BUCKET_W }} />)}
            <col style={{ width: GRAND_W }} />
          </colgroup>
          <thead>
            <tr className="text-primary-foreground">
              {levels.map((l, i) => (
                <th
                  key={l}
                  style={i < frozenCount ? { left: leftOf(i) } : undefined}
                  className={`${TH} text-left ${i < frozenCount ? 'md:z-30 md:sticky' : ''} ${i === levels.length - 1 ? 'border-r border-primary-foreground/30' : ''}`}
                >
                  {LEVELS[l].label}
                </th>
              ))}
              {columns.map((c) => <th key={c} className={`${TH} whitespace-nowrap ${COLUMNS[c].numeric ? 'text-center' : 'text-left'}`}>{COLUMNS[c].label}</th>)}
              {buckets.map((b) => <th key={b} className={`${TH} text-right whitespace-nowrap`}>{b}</th>)}
              <th className={`${TH} text-right whitespace-nowrap`}>Grand Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isTotal = r.kind === 'total'
              const bg = isTotal ? FROZEN_BG.total : r.kind === 'node' ? FROZEN_BG.node : FROZEN_BG.ticket
              const rowTone = isTotal
                ? 'border-t border-border bg-muted/50 font-semibold'
                : r.kind === 'node' ? 'border-t border-border bg-muted/30 font-semibold'
                : 'border-t border-border/60 hover:bg-muted/30'
              return (
                <tr key={r.key} className={`group ${rowTone}`}>
                  {isTotal ? (
                    <td className={`${FROZEN} ${bg} px-3 py-2 align-top text-[12px] font-semibold text-foreground break-words`} style={{ left: 0 }} colSpan={levels.length}>{r.labels[0]}</td>
                  ) : (
                    levels.map((_, i) => (
                      <td
                        key={i}
                        style={i < frozenCount ? { left: leftOf(i) } : undefined}
                        className={`${i < frozenCount ? FROZEN : ''} ${bg} px-3 py-2 align-top text-[12px] break-words ${i === 0 ? 'font-semibold text-foreground' : 'text-foreground'} ${i === levels.length - 1 ? 'border-r border-border/70' : ''}`}
                      >
                        <span className="inline-flex items-center">
                          {r.toggles[i] && <Arrow t={r.toggles[i]!} />}
                          {r.labels[i]}
                        </span>
                      </td>
                    ))
                  )}
                  {columns.map((c) => (
                    <td key={c} className={`px-3 py-2 align-top text-[12px] break-words ${COLUMNS[c].numeric ? 'text-center tabular-nums' : ''}`}>
                      {r.ticket && (c === 'ticketNo'
                        ? <Link href={`/requests/${r.ticket.id}?from=%2Frequests%2Fqueue`} className="font-mono text-[11px] font-semibold text-primary hover:underline">{r.ticket.ticketNo}</Link>
                        : cellValue(r.ticket, c, statusLabel))}
                    </td>
                  ))}
                  {buckets.map((b) => <td key={b} className={`${num} align-top`}>{show(r.counts[b])}</td>)}
                  <td className={`${num} align-top font-semibold`}>{r.total || ''}</td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-primary/40 bg-primary/10 font-bold">
              <td className={`${FROZEN} ${FROZEN_BG.grand} border-r border-border/70 px-3 py-2 text-[12px]`} style={{ left: 0 }} colSpan={levels.length}>Grand Total</td>
              {columns.map((c) => <td key={c} />)}
              {buckets.map((b) => <td key={b} className={num}>{show(grand.counts[b])}</td>)}
              <td className={num}>{grand.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
