'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgeSummary, DayCounts } from '@/lib/reporting/analytics/age-summary'
import {
  flattenSummary, collapsedForLevel, levelOf, type Collapsed, type DetailLevel, type ToggleTarget,
} from '@/lib/reporting/analytics/summary-rows'
import { ExportAgeBucketButton } from './ExportAgeBucketButton'

type ExportProps = {
  slug: string; group: string; services: string[]; preset: string; from: string; to: string; statuses: string[]
}

const LEVELS: { value: DetailLevel; label: string }[] = [
  { value: 'technicians', label: 'Technicians' },
  { value: 'categories', label: '+ Categories' },
  { value: 'subcategories', label: '+ Sub categories' },
]

// ── Frozen heading row and frozen first three columns ───────────────────────────────────────────────
// The table scrolls inside its own box. The heading row stays at the top while the rows scroll, and on
// screens wide enough (md and up) Responsible / Category / Sub Category stay at the left while the
// buckets scroll sideways. Frozen cells must be solid (a see-through one would show what slides under it),
// so each row type has a solid background mixed from the theme colours. Widths are fixed so the left
// offsets of the second and third frozen column are exact.
const W = { tech: 150, cat: 190, sub: 210, bucket: 84, grand: 96, day: 118 }
const LEFT = ['md:left-0', 'md:left-[150px]', 'md:left-[340px]'] // = 0, W.tech, W.tech + W.cat
// (written out in full: Tailwind only generates class names it can read in the source)
const FROZEN_BG = {
  sub: 'bg-card group-hover:bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]',
  tech: 'bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]',
  total: 'bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]',
  grand: 'bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))]',
}
const FROZEN = 'md:sticky md:z-[5]'
const TH = 'sticky top-0 z-10 bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide'
const DAY_HEAD_BG = 'color-mix(in srgb, var(--primary) 82%, white)'

/**
 * The summary table, pivot-style: every technician and category has a ▸/▾ arrow to collapse it to one
 * line of totals or expand it again, and the three level buttons show Technicians / + Categories /
 * + Sub categories everywhere at once. Export to Excel follows exactly what is on screen.
 */
export function AgeSummaryView({ summary, dayWord, exportProps }: { summary: AgeSummary; dayWord: string; exportProps: ExportProps }) {
  const [collapsed, setCollapsed] = useState<Collapsed>({ tech: new Set(), cat: new Set() })
  const rows = useMemo(() => flattenSummary(summary, collapsed), [summary, collapsed])
  const level = levelOf(summary, collapsed)
  const { buckets, grand } = summary

  function toggle(t: ToggleTarget) {
    setCollapsed((prev) => {
      const set = new Set(t.type === 'tech' ? prev.tech : prev.cat)
      if (t.expanded) set.add(t.key); else set.delete(t.key)
      return t.type === 'tech' ? { tech: set, cat: prev.cat } : { tech: prev.tech, cat: set }
    })
  }

  const num = 'px-3 py-2 text-right text-[12px] tabular-nums'
  const show = (n: number | undefined) => (n ? n : '')
  const dayHead = [`Created ${dayWord}`, `Resolved ${dayWord}`]
  const dayCells = (d: DayCounts) => (
    <>
      <td className={`${num} border-l border-border/60`}>{show(d.created)}</td>
      <td className={num}>{show(d.resolved)}</td>
    </>
  )
  const tableWidth = W.tech + W.cat + W.sub + buckets.length * W.bucket + W.grand + 2 * W.day

  const Arrow = ({ t, label }: { t: ToggleTarget; label: string }) => (
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

  if (summary.technicians.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end"><ExportAgeBucketButton {...exportProps} collapsedTech={[]} collapsedCat={[]} /></div>
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No tickets match these filters</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a wider date range, include more statuses or services.</p>
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
                onClick={() => setCollapsed(collapsedForLevel(summary, l.value))}
                aria-pressed={level === l.value}
                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${level === l.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">or use the arrows to open or close one row</span>
        </div>
        <ExportAgeBucketButton {...exportProps} collapsedTech={[...collapsed.tech]} collapsedCat={[...collapsed.cat]} />
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: W.tech }} /><col style={{ width: W.cat }} /><col style={{ width: W.sub }} />
            {buckets.map((b) => <col key={b} style={{ width: W.bucket }} />)}
            <col style={{ width: W.grand }} />
            <col style={{ width: W.day }} /><col style={{ width: W.day }} />
          </colgroup>
          <thead>
            <tr className="text-primary-foreground">
              <th className={`${TH} md:z-30 ${LEFT[0]} text-left`}>Responsible</th>
              <th className={`${TH} md:z-30 ${LEFT[1]} text-left`}>Category</th>
              <th className={`${TH} md:z-30 ${LEFT[2]} text-left border-r border-primary-foreground/30`}>Sub Category</th>
              {buckets.map((b) => (
                <th key={b} className={`${TH} text-right whitespace-nowrap`}>{b}</th>
              ))}
              <th className={`${TH} text-right whitespace-nowrap`}>Grand Total</th>
              {dayHead.map((h, i) => (
                <th key={h} style={{ backgroundColor: DAY_HEAD_BG }} className={`${TH} text-right ${i === 0 ? 'border-l border-primary-foreground/30' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isTotal = r.kind === 'techTotal'
              const isTechRow = r.kind === 'tech'
              const bg = isTotal ? FROZEN_BG.total : isTechRow || r.kind === 'cat' ? FROZEN_BG.tech : FROZEN_BG.sub
              return (
                <tr
                  key={r.key}
                  className={`group ${isTotal ? 'border-t border-border bg-muted/50 font-semibold' : isTechRow ? 'border-t border-border bg-muted/30 font-semibold' : r.kind === 'cat' ? 'border-t border-border/60 bg-muted/30' : 'border-t border-border/60 hover:bg-muted/30'}`}
                >
                  <td className={`${FROZEN} ${LEFT[0]} ${bg} px-3 py-2 text-[12px] font-semibold text-foreground break-words ${isTotal ? 'border-r border-border/70' : ''}`} colSpan={isTotal ? 3 : 1}>
                    <span className="inline-flex items-center">
                      {r.techToggle && <Arrow t={r.techToggle} label={r.techToggle.key} />}
                      {r.techLabel}
                    </span>
                  </td>
                  {!isTotal && (
                    <>
                      <td className={`${FROZEN} ${LEFT[1]} ${bg} px-3 py-2 text-[12px] text-foreground break-words`}>
                        <span className="inline-flex items-center">
                          {r.catToggle && <Arrow t={r.catToggle} label={r.catLabel} />}
                          {r.catLabel}
                        </span>
                      </td>
                      <td className={`${FROZEN} ${LEFT[2]} ${bg} border-r border-border/70 px-3 py-2 text-[12px] text-muted-foreground break-words`}>{r.subLabel}</td>
                    </>
                  )}
                  {buckets.map((b) => <td key={b} className={num}>{show(r.counts[b])}</td>)}
                  <td className={`${num} font-semibold`}>{r.total || ''}</td>
                  {dayCells(r.day)}
                </tr>
              )
            })}
            <tr className="border-t-2 border-primary/40 bg-primary/10 font-bold">
              <td className={`${FROZEN} ${LEFT[0]} ${FROZEN_BG.grand} border-r border-border/70 px-3 py-2 text-[12px]`} colSpan={3}>Grand Total</td>
              {buckets.map((b) => <td key={b} className={num}>{show(grand.counts[b])}</td>)}
              <td className={num}>{grand.total}</td>
              {dayCells(grand.day)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
