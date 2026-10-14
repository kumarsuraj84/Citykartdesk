'use client'

import { useState } from 'react'
import { cellText, type ReportColumn, type ReportRow, type ReportTable } from '@/lib/reporting/analytics/report-table'
import { ExportReportButton } from './ExportReportButton'
import { ReportDetail } from './ReportDetail'

// The look of the Excel pivot tables these reports replace: blue heading band, peach total columns, the first column in pale blue, bold blue "Total" lines,
// thin grey grid. Drawn like a sheet of paper (fixed colours, not the app theme), the same as the exported Excel file.
const COLOR = { head: '#4F81BD', peach: '#FBD9C3', tech: '#DCE6F1', total: '#B8CCE4', grid: '#C9D1DE', text: '#1F2937', green: '#E2EFDA', up: '#C6EFCE', upText: '#006100', down: '#FFC7CE', downText: '#9C0006' }
/** Small text and thin rows; each column is only as wide as its longest value (never wider than three quarters of its nominal width, which is where long text is cut). */
const CHAR_PX = 6.1
/** Bold capital headings are wider per character than the values. */
const HEAD_PX = 6.9
const PAD_PX = 19
const CAP = 0.75
const SHEET_FONT = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif"

interface Open { refs: number[]; title: string; subtitle: string }

/**
 * A fixed report as the Excel pivot shows it. Nothing to choose, nothing to fold: every value that has tickets behind it is clickable and opens them in a
 * pop-up (broken down by sub category, category, technician, store or cluster).
 */
export function ReportTableView({ table, choice }: { table: ReportTable; choice?: { status?: string; tech?: string; group?: string; service?: string; month?: string } }) {
  const [open, setOpen] = useState<Open | null>(null)
  const { columns, rows, headGroups, lead } = table

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-8 text-center">
        <p className="text-sm font-medium text-foreground">No tickets for this report right now</p>
      </div>
    )
  }

  // the width each column needs: its longest value or its heading
  const fit = columns.map((c, ci) => {
    // a short heading stays on one line; a long one wraps, so only its longest word counts (the column is never narrower than that)
    const headChars = c.label.length <= 14 ? c.label.length : Math.max(...c.label.split(' ').map((x) => x.length))
    const headPx = Math.ceil(headChars * HEAD_PX) + PAD_PX
    let chars = 3
    for (const r of rows) {
      if (r.kind !== 'row' && ci < lead) continue // a Total line's label spans the leading columns
      chars = Math.max(chars, cellText(r.cells[ci], c).length)
    }
    const bodyPx = Math.ceil(chars * CHAR_PX) + PAD_PX
    // a short value (a code, a date, a status) always fits; only long text is cut at the cap
    return Math.max(headPx, chars <= 16 ? bodyPx : Math.min(Math.round(c.width * CAP), bodyPx))
  })
  const w = (c: ReportColumn) => fit[columns.indexOf(c)]
  const left = columns.map((_, i) => fit.slice(0, i).reduce((n, x) => n + x, 0))
  const width = fit.reduce((n, x) => n + x, 0)
  const td = 'border px-1.5 py-0 text-[11px] leading-[16px]'
  const grid = { borderColor: COLOR.grid }
  const frozen = (i: number) => (i < lead ? 'md:sticky md:z-[5]' : '')
  const headStyle: React.CSSProperties = { backgroundColor: COLOR.head, borderColor: '#ffffff55' }
  const peachStyle: React.CSSProperties = { backgroundColor: COLOR.peach, color: COLOR.text, borderColor: '#ffffff' }
  const hasGroups = headGroups.length > 0
  const groupAt = (i: number) => headGroups.find((g) => g.from === i)
  const inGroup = (i: number) => headGroups.some((g) => i >= g.from && i < g.from + g.span)
  const align = (c: ReportColumn) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')

  /** What the clicked row is about, in words: its leading labels (a blank technician takes the one above). */
  const rowLabel = (idx: number): string => {
    const r = rows[idx]
    const first = (j: number) => {
      for (let k = idx; k >= 0; k--) { const v = rows[k].cells[j]; if (v !== '' && v !== null && rows[k].kind !== 'grand') return String(v) }
      return ''
    }
    if (r.kind === 'grand') return 'Grand Total'
    if (r.kind === 'subtotal') return String(r.cells[0])
    const parts = Array.from({ length: Math.min(lead, columns.length) }, (_, j) => (r.cells[j] === '' ? (j === 0 ? first(0) : '') : String(r.cells[j])))
    return parts.filter(Boolean).join(' · ')
  }
  const openCell = (idx: number, ci: number) => {
    const refs = rows[idx].refs[ci]
    if (!refs) return
    setOpen({ refs, title: table.title, subtitle: [rowLabel(idx), columns[ci].label].filter((x, i, a) => x && a.indexOf(x) === i).join(' - ') })
  }

  const cell = (r: ReportRow, idx: number, ci: number) => {
    const c = columns[ci]
    const text = cellText(r.cells[ci], c)
    const total = r.kind !== 'row'
    const v = r.cells[ci]
    // the Excel weekly sheet's shading: Resolved columns light green; a difference green above 0 and red below 0 (never on a total line)
    const bg: React.CSSProperties = total ? { backgroundColor: COLOR.total }
      : c.diff && typeof v === 'number' && v > 0 ? { backgroundColor: COLOR.up, color: COLOR.upText }
      : c.diff && typeof v === 'number' && v < 0 ? { backgroundColor: COLOR.down, color: COLOR.downText }
      : c.tint === 'green' ? { backgroundColor: COLOR.green } : {}
    const base = `${td} ${align(c)} ${c.align === 'right' || c.align === 'center' ? 'tabular-nums' : ''} ${total ? 'font-bold' : ''}`
    if (!text) return <td key={ci} className={base} style={{ ...grid, ...bg }} />
    return (
      <td key={ci} className={`${base} p-0`} style={{ ...grid, ...bg }}>
        {r.refs[ci] ? (
          <button type="button" onClick={() => openCell(idx, ci)} aria-label={`${rowLabel(idx)}, ${c.label}: ${text}`} title={text}
            className={`block w-full truncate px-1.5 py-0 hover:bg-black/10 hover:underline ${align(c)}`}>{text}</button>
        ) : <span className="block truncate px-1.5 py-0" title={text}>{text}</span>}
      </td>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">Click any value to see its tickets.</p>
        <ExportReportButton slug={table.slug} choice={choice} />
      </div>

      <div className="max-h-[78vh] overflow-auto rounded-md border bg-white" style={{ borderColor: COLOR.grid, fontFamily: SHEET_FONT, color: COLOR.text }}>
        <table className="border-collapse" style={{ tableLayout: 'fixed', width, minWidth: '100%' }}>
          <colgroup>{columns.map((c) => <col key={c.key} style={{ width: w(c) }} />)}</colgroup>
          <thead className="sticky top-0 z-10">
            {hasGroups && (
              <tr>
                {columns.map((c, i) => {
                  const g = groupAt(i)
                  if (g) return <th key={c.key} colSpan={g.span} className={`border px-1 py-0.5 text-center text-[11px] font-bold ${g.peach ? '' : 'text-white'}`} style={g.peach ? peachStyle : headStyle}>{g.label}</th>
                  if (inGroup(i)) return null
                  if (c.peach) return <th key={c.key} rowSpan={2} className="border px-1 py-0.5 text-center text-[11px] font-bold" style={peachStyle}>{c.label}</th>
                  return <th key={c.key} className={`border ${frozen(i)} md:z-30`} style={{ ...headStyle, left: left[i] }} />
                })}
              </tr>
            )}
            <tr>
              {columns.map((c, i) => {
                if (hasGroups && c.peach) return null
                return c.peach || c.headTone === 'peach'
                  ? <th key={c.key} className="border px-1 py-0.5 text-center text-[11px] font-bold" style={peachStyle}>{c.label}</th>
                  : <th key={c.key} className={`border px-1.5 py-0.5 text-[11px] font-bold text-white ${align(c)} break-words ${i < lead ? 'md:sticky md:z-30' : ''}`} style={{ ...headStyle, left: left[i] }}>{c.label}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const total = r.kind !== 'row'
              return (
                <tr key={r.key}>
                  {columns.map((c, ci) => {
                    if (total && ci > 0 && ci < lead) return null
                    if (total && ci === 0) {
                      return <td key={ci} colSpan={lead} className={`${td} ${frozen(0)} font-bold`} style={{ ...grid, left: 0, backgroundColor: COLOR.total }}>{String(r.cells[0] ?? '')}</td>
                    }
                    if (ci < lead) {
                      const text = cellText(r.cells[ci], c)
                      const bg = ci === 0 ? COLOR.tech : '#ffffff'
                      return (
                        <td key={ci} className={`${td} ${frozen(ci)} ${ci === 0 ? 'font-bold' : ''} p-0`} style={{ ...grid, left: left[ci], backgroundColor: bg }}>
                          {text && r.refs[ci] ? (
                            <button type="button" onClick={() => openCell(idx, ci)} aria-label={`${rowLabel(idx)}, ${c.label}: ${text}`} title={text}
                              className={`block w-full truncate px-1.5 py-0 hover:underline ${align(c)}`}>{text}</button>
                          ) : <span className="block truncate px-1.5 py-0" title={text}>{text}</span>}
                        </td>
                      )
                    }
                    return cell(r, idx, ci)
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {open && <ReportDetail tickets={open.refs.map((i) => table.tickets[i])} title={open.title} subtitle={open.subtitle} onClose={() => setOpen(null)} />}
    </div>
  )
}
