'use client'

import { useMemo, useState } from 'react'
import { Clock, ExternalLink, RotateCcw } from 'lucide-react'
import { MEASURES, ageInDays, applyFilters, capitalize, heatmap, inWin, statusLabel, type Measure } from '@/lib/reporting/executive/engine'
import { explorerBase } from '@/lib/reporting/executive/explorer'
import type { KpiKey } from '@/lib/reporting/executive/kpi-context'
import { WEEKDAYS_SHORT } from '@/lib/reporting/executive/labels'
import type { DashData, OpenDrill } from './types'
import { Panel, PanelTitle, Seg, SlaMark } from './ui'

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
const DAYS: number[] = [1, 2, 3, 4, 5, 6, 0] // Monday first
const hourLabel = (h: number) => `${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}`
const MAX_ROWS = 100

function cellClass(v: number, selected: boolean, max: number): string {
  if (selected) return 'bg-primary text-primary-foreground ring-2 ring-ring ring-offset-1 font-bold'
  if (v === 0) return 'bg-muted/70 text-transparent hover:bg-muted'
  const r = v / Math.max(1, max)
  if (r <= 0.25) return 'bg-primary/15 text-foreground hover:bg-primary/25'
  if (r <= 0.5) return 'bg-primary/35 text-foreground hover:bg-primary/45 font-medium'
  if (r <= 0.75) return 'bg-primary/65 text-primary-foreground hover:bg-primary/75 font-semibold'
  return 'bg-primary text-primary-foreground hover:bg-primary/90 font-bold'
}

/** When tickets arrive (weekday × hour) and the tickets behind the selected number. */
export function ExplorerSection({ d, metric, onOpen, onReset }: {
  d: DashData; metric: KpiKey; onOpen: OpenDrill; onReset: () => void
}) {
  const { tickets, approvals, filters, now, W } = d
  const [cell, setCell] = useState<{ day: number; hour: number; n: number } | null>(null)
  const [slaTab, setSlaTab] = useState<'all' | 'breached' | 'ok'>('all')
  const label = metric === 'approvals' ? 'Approvals waiting' : MEASURES[metric as Measure].label

  const base = useMemo(() => applyFilters(tickets, filters, now), [tickets, filters, now])
  const { cells, max } = useMemo(() => heatmap(base, W), [base, W])

  // busiest weekdays and the most intensive 3-day / 6-hour window
  const insight = useMemo(() => {
    const total = [...cells.values()].reduce((n, v) => n + v, 0)
    if (total === 0) return null
    const perDay = DAYS.map((day) => ({ day, n: HOURS.reduce((s, h) => s + (cells.get(`${day}_${h}`) ?? 0), 0) }))
    let best = { share: 0, d0: 0, h0: 0 }
    for (let i = 0; i + 2 < DAYS.length; i++) for (let h = 0; h + 5 < HOURS.length; h++) {
      let s = 0
      for (let x = i; x < i + 3; x++) for (let y = h; y < h + 6; y++) s += cells.get(`${DAYS[x]}_${HOURS[y]}`) ?? 0
      if (s > best.share) best = { share: s, d0: i, h0: h }
    }
    const peaks = [...cells].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => { const [dd, hh] = k.split('_').map(Number); return `${WEEKDAYS_SHORT[dd]} ${hourLabel(hh)} (${n})` })
    const busiest = [...perDay].sort((a, b) => b.n - a.n).slice(0, 2)
    return {
      window: `${WEEKDAYS_SHORT[DAYS[best.d0]]} - ${WEEKDAYS_SHORT[DAYS[best.d0 + 2]]} (${hourLabel(HOURS[best.h0])} - ${hourLabel(HOURS[best.h0 + 5] + 1)})`,
      share: Math.round((best.share / total) * 100), peaks, busiest: busiest.map((b) => `${WEEKDAYS_SHORT[b.day]} (${b.n})`).join(' & '),
    }
  }, [cells])

  const behind = useMemo(() => explorerBase(tickets, approvals, filters, W, now, metric), [tickets, approvals, filters, W, now, metric])
  const list = useMemo(() => behind.filter((t) => {
    if (cell) { const c = new Date(t.created); if (c.getDay() !== cell.day || c.getHours() !== cell.hour || !inWin(t.created, W)) return false }
    return true
  }), [behind, cell, W])
  const shown = list.filter((t) => (slaTab === 'breached' ? t.breached : slaTab === 'ok' ? !t.breached : true))
  const filtered = !!cell || slaTab !== 'all'

  return (
    <section id="explorer-section" aria-label="Arrival heatmap and ticket explorer" className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
      <Panel className="flex flex-col justify-between lg:col-span-5">
        <div>
          <PanelTitle
            title="When do tickets arrive?"
            caption="Tickets created by weekday and hour - useful for shift planning. Click a cell to list just those tickets."
            right={cell && <button type="button" onClick={() => setCell(null)} className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/20">{WEEKDAYS_SHORT[cell.day]} {hourLabel(cell.hour)}: {cell.n} tickets ×</button>}
          />
          {insight ? (
            <div className="mt-3.5 space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs">
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0 text-primary" />Peak staffing window: {insight.window}</span>
                <span className="tabular-nums text-primary">{insight.share}% of intake</span>
              </div>
              <p className="leading-relaxed text-muted-foreground">Highest hourly surges: {insight.peaks.map((p, i) => <strong key={i} className="text-foreground">{i ? ', ' : ''}{p}</strong>)}.</p>
            </div>
          ) : <p className="mt-4 text-xs text-muted-foreground">No tickets were created in this period.</p>}

          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[380px]">
              <div className="mb-1 grid gap-1 text-center text-[11px] tabular-nums text-muted-foreground" style={{ gridTemplateColumns: `34px repeat(${HOURS.length}, minmax(0, 1fr))` }}>
                <div />{HOURS.map((h) => <div key={h}>{hourLabel(h)}</div>)}
              </div>
              <div className="space-y-1">
                {DAYS.map((day) => (
                  <div key={day} className="grid items-center gap-1" style={{ gridTemplateColumns: `34px repeat(${HOURS.length}, minmax(0, 1fr))` }}>
                    <div className="pr-1 text-xs font-medium text-muted-foreground">{WEEKDAYS_SHORT[day]}</div>
                    {HOURS.map((h) => {
                      const v = cells.get(`${day}_${h}`) ?? 0
                      const sel = cell?.day === day && cell.hour === h
                      return (
                        <button key={h} type="button" onClick={() => setCell(sel ? null : { day, hour: h, n: v })} title={`${WEEKDAYS_SHORT[day]} ${hourLabel(h)}: ${v} tickets created`}
                          className={`flex h-7 items-center justify-center rounded-[3px] text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cellClass(v, sel, max)}`}>
                          {v > 0 ? v : ''}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Volume intensity:</span>
            <span className="flex items-center gap-1">{['bg-muted', 'bg-primary/15', 'bg-primary/35', 'bg-primary/65', 'bg-primary'].map((c) => <span key={c} className={`inline-block h-3 w-4 rounded-[2px] ${c}`} />)}</span>
            <span className="text-[11px]">(0 to {max}/hr)</span>
          </div>
          {insight && <span className="tabular-nums">{insight.busiest} busiest</span>}
        </div>
      </Panel>

      <Panel className="flex flex-col justify-between overflow-hidden !p-0 lg:col-span-7">
        <div>
          <div className="space-y-3 border-b border-border p-5">
            <PanelTitle
              title={`${behind.length} ticket${behind.length === 1 ? '' : 's'} behind the numbers (${label})`}
              caption="These follow the selected number and every filter above. Click a ticket for its full timeline and store details."
              right={
                <Seg value={slaTab} onChange={setSlaTab} label="SLA" options={[
                  { value: 'all', label: `All (${list.length})` },
                  { value: 'breached', label: `Breached (${list.filter((t) => t.breached).length})` },
                  { value: 'ok', label: `SLA OK (${list.filter((t) => !t.breached).length})` },
                ]} />
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Use the search box in the filter bar above to find a ticket by number, subject, store or technician.</p>
              {filtered && (
                <button type="button" onClick={() => { setSlaTab('all'); setCell(null); onReset() }} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/70">
                  <RotateCcw className="h-3 w-3" />Reset filters
                </button>
              )}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="space-y-2 p-10 text-center">
              <p className="text-sm font-semibold text-foreground">No tickets match the current filter combination</p>
              <p className="mx-auto max-w-md text-xs text-muted-foreground">Clear one of the filters, the search or the SLA tab to see matching requests.</p>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 border-b border-border bg-muted text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2.5 pl-5 pr-2">Ticket</th><th className="px-2 py-2.5">Subject</th><th className="px-2 py-2.5">Group / technician</th><th className="px-2 py-2.5">Priority</th><th className="px-2 py-2.5">Status</th><th className="px-2 py-2.5 text-right">Age</th><th className="py-2.5 pl-2 pr-5 text-right">SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
                  {shown.slice(0, MAX_ROWS).map((t) => (
                    <tr key={t.id} onClick={() => onOpen({ title: `${t.no} - last leg lifecycle`, subtitle: `${t.store} · ${t.group} · ${t.tech}`, stage: 4, metric: 'created', ticketId: t.id, dims: {} })} className="group cursor-pointer transition-colors hover:bg-primary/5">
                      <td className="whitespace-nowrap py-2.5 pl-5 pr-2"><span className="inline-flex items-center gap-1 font-semibold tabular-nums text-primary group-hover:underline">{t.no}<ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" /></span></td>
                      <td className="max-w-[230px] px-2 py-2.5">
                        <div className="truncate font-medium text-foreground" title={t.subject}>{t.subject}</div>
                        <div className="truncate text-[11px] text-muted-foreground">Store: {t.store}{t.oem !== '(No OEM)' ? ` · OEM: ${t.brand}` : ''}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5"><div className="font-medium text-foreground">{t.group}</div><div className="text-[11px] text-muted-foreground">{t.tech}</div></td>
                      <td className={`whitespace-nowrap px-2 py-2.5 ${t.prio === 'urgent' || t.prio === 'high' ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>{capitalize(t.prio)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-foreground">{statusLabel(t.status)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-muted-foreground">{ageInDays(t, now)}d</td>
                      <td className="whitespace-nowrap py-2.5 pl-2 pr-5 text-right"><SlaMark breached={t.breached} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
          <span>Showing <strong className="tabular-nums text-foreground">{Math.min(shown.length, MAX_ROWS)}</strong> of <strong className="tabular-nums text-foreground">{shown.length}</strong> for <strong className="text-foreground">{label}</strong>{shown.length > MAX_ROWS ? ' (narrow with a filter or search to see the rest)' : ''}.</span>
          <span>Use the Pop-up breakdown on any number card to inspect it by group, store and technician</span>
        </div>
      </Panel>
    </section>
  )
}
