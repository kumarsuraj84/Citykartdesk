'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoveControls } from './MoveControls'
import { filterRows, pruneSelection, selectRange, selectReady, toggleOne, viewCounts, type View } from '@/lib/zoho/transfer/select'

export type WorkbenchRow = {
  zohoNo: number
  ready: boolean
  /** the codes of the problems that stop it moving */
  codes: string[]
  /** the table cells after the tick box, drawn on the server */
  cells: ReactNode
}
export type ReasonChip = { code: string; title: string; count: number }

const fmt = (n: number) => n.toLocaleString('en-IN')

/**
 * The result of a search on the "Move Zoho tickets" screen: one compact bar (how many match, how many can be moved, views, the reasons, "select all that can be moved", Move) and the table
 * below it, which takes the rest of the screen with its headings frozen. The tick boxes live here, so "select all", "shift-click a range", the views and the move button all share one selection.
 * Only a ready ticket can be ticked, and never more than one batch (limit) at a time.
 */
export function MoveWorkbench({ rows, reasons, total, truncated, canMove, limit, unmatched, notice, fixHref }: {
  rows: WorkbenchRow[]
  reasons: ReasonChip[]
  total: number
  truncated: boolean
  canMove: boolean
  limit: number
  unmatched: number
  /** the yellow "people not matched" notice, drawn on the server */
  notice: ReactNode
  /** where to map what the blocked tickets need */
  fixHref: string | null
}) {
  const router = useRouter()
  const [view, setView] = useState<View>('all')
  const [reason, setReason] = useState<string | null>(null)
  const [picked, setSelected] = useState<number[]>([])
  const [hint, setHint] = useState<string | null>(null)
  // compact (default): two short lines per ticket so about 6 tickets fit in the frozen window; full: every detail on every line
  const [compact, setCompact] = useState(true)
  const last = useRef<number | null>(null)

  const counts = useMemo(() => viewCounts(rows), [rows])
  const visible = useMemo(() => filterRows(rows, view, reason), [rows, view, reason])
  const readyVisible = visible.filter((r) => r.ready)
  // after a refresh (tickets moved) whatever is no longer ready drops out of the selection by itself
  const selected = useMemo(() => pruneSelection(picked, rows), [picked, rows])
  const sel = useMemo(() => new Set(selected), [selected])

  function pickView(v: View) { setView(v); if (v === 'ready') setReason(null); setHint(null) }
  function pickReason(code: string) {
    if (reason === code) { setReason(null); return }
    setReason(code); if (view === 'ready') setView('blocked')
  }
  function selectAllReady() {
    const r = selectReady(visible, limit, selected)
    setSelected(r.selected)
    setHint(r.readyCount === 0 ? 'No ticket in this list can be moved yet.' : r.capped ? `${r.selected.length} ticked: only ${limit} can be moved at a time, and ${fmt(r.readyCount - r.selected.length)} more are ready. Move these, then press the button again for the next ${limit}.` : null)
  }
  function clearAll() { setSelected([]); setHint(null) }
  function click(e: React.MouseEvent, row: WorkbenchRow) {
    if (e.shiftKey && last.current !== null && last.current !== row.zohoNo) {
      const r = selectRange(visible, last.current, row.zohoNo, selected, limit)
      setSelected(r.selected)
      setHint(r.capped ? `Only ${limit} can be ticked at a time.` : null)
    } else {
      const r = toggleOne(selected, row, limit)
      setSelected(r.selected)
      setHint(r.refusedForLimit ? `Only ${limit} can be moved at a time. Untick one first, or move these and continue.` : null)
    }
    last.current = row.zohoNo
  }
  const allReadyTicked = readyVisible.length > 0 && readyVisible.slice(0, limit).every((r) => sel.has(r.zohoNo))
  const someTicked = readyVisible.some((r) => sel.has(r.zohoNo))

  const seg = (v: View, label: string, n: number, tone: string) => (
    <button key={v} type="button" onClick={() => pickView(v)} aria-pressed={view === v} className={`rounded-md border px-2.5 py-1 text-xs ${view === v ? `${tone} font-semibold` : 'border-border text-muted-foreground hover:text-foreground'}`}>
      {label} <span className="tabular-nums">{fmt(n)}</span>
    </button>
  )

  return (
    <div className="space-y-2">
      <section aria-label="Summary and selection" className="space-y-2 rounded-lg border border-border bg-card p-2.5">
        {notice}

        {/* ONE row: which tickets to show (with the counts), the reason filter, then select all / clear / Move. It wraps on a narrow window. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which tickets to show">
            {seg('all', 'All', counts.all, 'border-primary bg-primary/10 text-foreground')}
            {seg('ready', 'Can be moved', counts.ready, 'border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300')}
            {seg('blocked', 'Cannot move yet', counts.blocked, 'border-red-500 bg-red-500/10 text-red-800 dark:text-red-300')}
          </div>
          {reasons.length > 0 && (
            <select aria-label="Show only the tickets stopped for this reason" value={reason ?? ''} onChange={(e) => (e.target.value ? pickReason(e.target.value) : setReason(null))}
              className="max-w-[16rem] rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground">
              <option value="">Any reason</option>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.title}: {fmt(r.count)}</option>)}
            </select>
          )}
          {(reason || view !== 'all') && <button type="button" onClick={() => { setView('all'); setReason(null) }} className="text-[11px] text-muted-foreground hover:text-foreground">Show all</button>}

          {canMove && (
            <>
              <span className="mx-1 hidden h-5 w-px bg-border lg:inline-block" aria-hidden />
              <button type="button" onClick={selectAllReady} disabled={readyVisible.length === 0} className="rounded-md border border-primary px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50">
                Select all that can be moved{readyVisible.length ? ` (${readyVisible.length > limit ? `first ${limit} of ${fmt(readyVisible.length)}` : fmt(readyVisible.length)})` : ''}
              </button>
              <button type="button" onClick={clearAll} disabled={selected.length === 0} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">Clear ticks</button>
              <span className="text-xs text-foreground" aria-live="polite"><strong className="tabular-nums">{selected.length}</strong> ticked{selected.length ? ` of ${limit} allowed at a time` : ''}</span>
              <MoveControls canMove={canMove} selected={selected} limit={limit} unmatched={unmatched} onMoved={() => { setSelected([]); setHint(null); router.refresh() }} />
            </>
          )}

          <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
            <button type="button" onClick={() => setCompact((c) => !c)} aria-pressed={!compact} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-muted" title="Compact rows show two short lines per ticket; full details show everything. The full text is always in the tooltip.">{compact ? 'Show full details' : 'Compact rows'}</button>
            {truncated && <span>newest {fmt(rows.length)} of {fmt(total)} shown</span>}
            {fixHref && counts.blocked > 0 && <Link href={fixHref} className="font-medium text-primary hover:underline">Map what the blocked tickets need →</Link>}
          </span>
        </div>
        {hint && <p role="status" className="text-[11px] text-amber-800 dark:text-amber-300">{hint}</p>}
        {!canMove && <p className="text-[11px] text-muted-foreground">Only an administrator can move tickets. You can preview them.</p>}
      </section>

      {/* at least 6 tickets stay in view (the page scrolls when the window is too short for the toolbar AND six tickets) */}
      <div className={`overflow-x-auto rounded-lg border border-border bg-card ${compact ? '[&_.ck-extra]:hidden [&_.ck-line]:max-w-full [&_.ck-line]:truncate' : '[&_.ck-compact-only]:hidden'}`}
        style={{ minHeight: Math.min(visible.length, 6) * (compact ? 50 : 120) + 48 }} tabIndex={0} role="region" aria-label="Preview of the Zoho tickets">
        <table className={`w-full text-left text-xs ${compact ? 'min-w-[900px] table-fixed' : 'min-w-[1100px]'}`}>
          {/* compact rows: fixed column widths that add up to the window, so every column (and the reason in the last one) is in view without sideways scrolling */}
          {compact && <colgroup><col className="w-9" /><col className="w-[13%]" /><col className="w-[9%]" /><col className="w-[21%]" /><col className="w-[10%]" /><col className="w-[13%]" /><col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[17%]" /></colgroup>}
          <thead>
            <tr className="border-b border-border bg-muted/40 text-muted-foreground">
              <th className="px-2 py-2 font-medium">
                {canMove ? (
                  <input type="checkbox" aria-label="Tick or untick every ticket that can be moved in this list" checked={allReadyTicked} ref={(el) => { if (el) el.indeterminate = !allReadyTicked && someTicked }}
                    onChange={() => (allReadyTicked ? clearAll() : selectAllReady())} disabled={readyVisible.length === 0} />
                ) : 'Move'}
              </th>
              <th className="px-2 py-2 font-medium">Zoho → CK Desk number</th><th className="px-2 py-2 font-medium">Created (same as Zoho)</th>
              <th className="px-2 py-2 font-medium">Where it goes in CK Desk</th><th className="px-2 py-2 font-medium">Requester</th><th className="px-2 py-2 font-medium">Technician</th>
              <th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">CK Desk priority and SLA</th><th className="px-2 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.zohoNo} className={`border-b border-border/60 align-top ${sel.has(r.zohoNo) ? 'bg-primary/5' : ''}`}>
                <td className="px-2 py-2">
                  {r.ready && canMove
                    ? <input type="checkbox" checked={sel.has(r.zohoNo)} onChange={() => {}} onClick={(e) => click(e, r)} aria-label={`Move Zoho ticket ${r.zohoNo}`} />
                    : <span className="text-muted-foreground" aria-hidden="true">–</span>}
                </td>
                {r.cells}
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={9} className="px-2 py-6 text-center text-muted-foreground">{rows.length === 0 ? 'No Zoho ticket matches these filters.' : 'No ticket in this view. Choose “All” above.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
