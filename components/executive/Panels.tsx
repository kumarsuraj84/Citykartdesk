'use client'

import { useMemo, useState } from 'react'
import {
  DIM_LABEL, MEASURES, ageInDays, compare, compareRows, formatMeasure, heatmap, statusLabel, ticketsBehind,
  type CompareRow, type Dim, type ExecTicket, type Filters, type Measure, type Win,
} from '@/lib/reporting/executive/engine'
import { Card, DeltaBadge, SelectBox } from './ui'

// ── Compare side by side ───────────────────────────────────────────────────────────────────────────

const CMP_COLS: Measure[] = ['created', 'resolved', 'backlog', 'breaches', 'sla', 'tat', 'frt', 'reopened', 'csat']
const SHOW = 15

/** Every measure for every item of a dimension, with the change vs the previous period. Click a column to sort, a row to filter. */
export function CompareTable({ title, caption, tickets, filters, now, W, P, compareOn, dims, defaultDim, onPick, onDrill, selectedFor }: {
  title: string
  caption: string
  tickets: ExecTicket[]
  filters: Filters
  now: number
  W: Win
  P: Win
  compareOn: boolean
  dims: Dim[]
  defaultDim: Dim
  onPick: (dim: Dim, key: string) => void
  onDrill: (dim: Dim, key: string) => void
  selectedFor: (dim: Dim) => string[]
}) {
  const [dim, setDim] = useState<Dim>(dims.includes(defaultDim) ? defaultDim : dims[0])
  const [sort, setSort] = useState<{ k: Measure | 'key'; dir: 1 | -1 }>({ k: 'created', dir: -1 })
  const [all, setAll] = useState(false)

  const rows = useMemo(() => {
    const r = compareRows(tickets, filters, dim, W, P, now)
    const { k, dir } = sort
    return r.sort((a: CompareRow, b: CompareRow) => {
      if (k === 'key') return dir * a.key.localeCompare(b.key)
      const x = a[k]; const y = b[k]
      if (x === null) return 1
      if (y === null) return -1
      return dir * (x - y)
    })
  }, [tickets, filters, dim, W, P, now, sort])
  const shown = all ? rows : rows.slice(0, SHOW)
  const sel = selectedFor(dim)
  const head = (k: Measure | 'key', label: string, right = true) => (
    <th key={k} onClick={() => setSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: k === 'key' ? 1 : -1 }))}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-[11px] uppercase tracking-wide ${right ? 'text-right' : 'text-left'} ${sort.k === k ? 'text-primary' : 'text-muted-foreground'}`}>
      {label}{sort.k === k ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
    </th>
  )
  return (
    <Card title={title} caption={caption} actions={<SelectBox label="Compare by" value={dim} onChange={(v) => { setDim(v as Dim); setAll(false) }} options={dims.map((d) => ({ value: d, label: DIM_LABEL[d] }))} />}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead><tr className="border-b border-border">{head('key', DIM_LABEL[dim], false)}{CMP_COLS.map((m) => head(m, MEASURES[m].short))}<th /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} onClick={() => onPick(dim, r.key)} className={`cursor-pointer border-b border-border/60 hover:bg-muted/50 ${sel.includes(r.key) ? 'bg-primary/10 font-semibold' : ''}`}>
                <td className="max-w-[220px] truncate px-2 py-1.5" title={r.key}>{statusLabel(r.key)}</td>
                {CMP_COLS.map((m) => (
                  <td key={m} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {formatMeasure(m, r[m])}
                    {compareOn && <span className="ml-1"><DeltaBadge d={compare(m, r[m], r[`prev_${m}`])} className="!text-[10.5px]" /></span>}
                  </td>
                ))}
                <td className="px-1 py-1">
                  <button type="button" title="Open details and drill down" aria-label={`Details of ${r.key}`} onClick={(e) => { e.stopPropagation(); onDrill(dim, r.key) }}
                    className="h-[22px] w-[22px] rounded-md border border-border bg-card text-[11px] font-extrabold leading-none text-primary hover:bg-primary hover:text-primary-foreground">▸</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={CMP_COLS.length + 2} className="py-6 text-center text-xs text-muted-foreground">Nothing to compare for this selection.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > SHOW && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-semibold text-primary underline underline-offset-2">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
      )}
    </Card>
  )
}

// ── When do tickets arrive? ────────────────────────────────────────────────────────────────────────

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
const WEEKDAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]

export function Heatmap({ tickets, W }: { tickets: ExecTicket[]; W: Win }) {
  const { cells, max } = useMemo(() => heatmap(tickets, W), [tickets, W])
  return (
    <Card title="When do tickets arrive?" caption="Tickets created by weekday and hour - useful for planning who is on duty. Hover a cell for its count.">
      <div className="grid gap-[3px] text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `34px repeat(${HOURS.length}, minmax(0, 1fr))` }}>
        <div />
        {HOURS.map((h) => <div key={h} className="text-center font-bold">{h > 12 ? h - 12 : h}{h >= 12 ? 'p' : 'a'}</div>)}
        {WEEKDAYS.map(([d, name]) => (
          <div key={name} className="contents">
            <div className="flex items-center font-bold">{name}</div>
            {HOURS.map((h) => {
              const v = cells.get(`${d}_${h}`) ?? 0
              const a = v ? 0.15 + (0.85 * v) / Math.max(1, max) : 0
              return (
                <div key={h} title={`${name} ${h}:00 - ${v} tickets`} className="flex h-[22px] items-center justify-center rounded"
                  style={{ background: v ? `color-mix(in srgb, var(--primary) ${Math.round(a * 100)}%, transparent)` : 'var(--muted)', color: a > 0.55 ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }}>
                  {v || ''}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── The tickets behind the numbers ─────────────────────────────────────────────────────────────────

export function TicketListCard({ tickets, W, measure, hasAge, now, onOpen }: {
  tickets: ExecTicket[]; W: Win; measure: Measure; hasAge: boolean; now: number; onOpen: (id: string) => void
}) {
  const list = useMemo(() => ticketsBehind(tickets, W, measure, hasAge), [tickets, W, measure, hasAge])
  return (
    <Card title={`${list.length} ticket${list.length === 1 ? '' : 's'} behind the numbers`} caption={`These follow the selected number (${MEASURES[measure].label}) and every filter. Click a ticket for its full detail.`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5">Ticket</th><th className="px-2 py-1.5">Subject</th><th className="px-2 py-1.5">Group / Technician</th><th className="px-2 py-1.5">Priority</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5 text-right">Age</th><th className="px-2 py-1.5">SLA</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 10).map((t) => (
              <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer border-b border-border/60 hover:bg-muted/50">
                <td className="px-2 py-1.5 font-semibold text-primary">{t.no}</td>
                <td className="max-w-[220px] truncate px-2 py-1.5">{t.subject}</td>
                <td className="px-2 py-1.5">{t.group} / {t.tech}</td>
                <td className="px-2 py-1.5 capitalize">{t.prio}</td>
                <td className="px-2 py-1.5">{statusLabel(t.status)}</td>
                <td className="px-2 py-1.5 text-right">{ageInDays(t, now)}d</td>
                <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t.breached ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'}`}>{t.breached ? 'Breached' : 'OK'}</span></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">No tickets match.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.length > 10 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 10 of {list.length}. Use <b>Breakdown ▸</b> on any number to page through all of them.</p>}
    </Card>
  )
}

