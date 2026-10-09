'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, TrendingUp } from 'lucide-react'
import {
  DIM_LABEL, UNASSIGNED, applyFilters, approvalMeasure, approvalRows, approvalsBehind, compare, formatApproval, formatMeasure, inWin, keyOf, openAt,
  rankItems, type ApprovalMeasure, type Dim,
} from '@/lib/reporting/executive/engine'
import { dimsForLevel } from '@/lib/reporting/executive/levels'
import type { DashData, OpenDrill } from './types'
import { Chev, DeltaBadge, Panel, PanelTitle, Seg } from './ui'

type LeaderMeasure = 'resolved' | 'backlog'
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

function topBy<T>(items: T[], key: (t: T) => string): string {
  const c = new Map<string, number>()
  for (const i of items) c.set(key(i), (c.get(key(i)) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

export function PeopleApprovals({ d, onOpen }: { d: DashData; onOpen: OpenDrill }) {
  const { tickets, approvals, filters, now, W, P, compareOn, level } = d
  const [dimPick, setDim] = useState<Dim>(level === 'requester' ? 'cat' : 'tech')
  const [measureKey, setMeasureKey] = useState<LeaderMeasure>('resolved')
  const [order, setOrder] = useState<'top5' | 'bottom5'>('top5')

  const base = useMemo(() => applyFilters(tickets, filters, now), [tickets, filters, now])
  // OEM comparisons only make sense when some ticket in view is an equipment request (e.g. AC), not for an IT or HR group
  const hasOem = useMemo(() => base.some((t) => t.brand !== '(No OEM)'), [base])
  const dims = useMemo(() => dimsForLevel(level).filter((x) => x !== 'age' && x !== 'status' && (hasOem || (x !== 'brand' && x !== 'oem'))), [level, hasOem])
  const dim: Dim = useMemo(() => (dims.includes(dimPick) ? dimPick : dims.includes('tech') ? 'tech' : dims[0]), [dims, dimPick])
  const ap = useMemo(() => approvalRows(approvals, filters, now), [approvals, filters, now])

  // ── leaderboard ──
  const rows = useMemo(() => {
    const primary = rankItems(tickets, filters, dim, W, P, measureKey, now)
    const other = new Map(rankItems(tickets, filters, dim, W, P, measureKey === 'resolved' ? 'backlog' : 'resolved', now).map((r) => [r.key, r.value ?? 0]))
    const sorted = [...primary].sort((a, b) => (order === 'top5' ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0)) || a.key.localeCompare(b.key))
      .filter((r) => !(dim === 'tech' && r.key === UNASSIGNED))
    return sorted.slice(0, 5).map((r) => {
      const mine = base.filter((t) => keyOf(dim, t, now) === r.key)
      const sub = dim === 'tech' ? topBy(mine, (t) => t.group) : dim === 'group' ? topBy(mine.filter((t) => t.tech !== UNASSIGNED), (t) => t.tech) : ''
      return { key: r.key, value: r.value ?? 0, prev: r.prev, other: other.get(r.key) ?? 0, sub }
    })
  }, [tickets, filters, dim, W, P, measureKey, now, order, base])
  const maxV = Math.max(1, ...rows.map((r) => r.value))

  // workload callout
  const open = base.filter((t) => openAt(t, W.end))
  const perTech = (() => {
    const c = new Map<string, number>()
    for (const t of open) if (t.tech !== UNASSIGNED) c.set(t.tech, (c.get(t.tech) ?? 0) + 1)
    return [...c].sort((a, b) => b[1] - a[1])
  })()
  const top3 = perTech.slice(0, 3)
  const top3Share = pct(top3.reduce((n, x) => n + x[1], 0), open.length)

  // resolution concentration footer
  const resolvedIn = base.filter((t) => t.resolved !== null && inWin(t.resolved, W))
  const topGroup = topBy(resolvedIn, (t) => t.group)
  const topGroupN = resolvedIn.filter((t) => t.group === topGroup).length
  const assignees = new Set(base.filter((t) => t.tech !== UNASSIGNED).map((t) => t.tech)).size

  const openRow = (key: string) => {
    if (dim === 'tech') onOpen({ title: `Technician queue: ${key}`, subtitle: `Store-by-store breakdown and last-leg lifecycle for ${key}`, stage: 3, metric: measureKey, dims: { tech: key } })
    else if (dim === 'group') onOpen({ title: `Technician group: ${key}`, subtitle: `Stores, technicians and SLA breaches for ${key}`, stage: 2, metric: measureKey, dims: { group: key } })
    else if (dim === 'cat') onOpen({ title: `Category: ${key}`, subtitle: `Stores and tickets in ${key}`, stage: 2, metric: measureKey, dims: { cat: key } })
    else if (dim === 'brand') onOpen({ title: `OEM brand: ${key}`, subtitle: `Stores and tickets for ${key}`, stage: 2, metric: measureKey, dims: { brand: key } })
    else if (dim === 'store') onOpen({ title: `Store: ${key}`, subtitle: `Tickets raised by ${key}`, stage: 3, metric: measureKey, dims: { store: key } })
    else onOpen({ title: `${DIM_LABEL[dim]}: ${key}`, subtitle: `Drill-down for ${key}`, stage: 1, metric: measureKey })
  }

  // ── approvals ──
  const pending = approvalMeasure(ap, W, 'pending') ?? 0
  const approvedN = approvalMeasure(ap, W, 'approved') ?? 0
  const rejectedN = approvalMeasure(ap, W, 'rejected') ?? 0
  const rate = approvalMeasure(ap, W, 'rate')
  const cycle = approvalMeasure(ap, W, 'cycle')
  const waiting = approvalsBehind(ap, W, 'pending')
  const waitByGroup = (() => {
    const c = new Map<string, number>()
    for (const a of waiting) c.set(a.t.group, (c.get(a.t.group) ?? 0) + 1)
    return [...c].sort((a, b) => b[1] - a[1]).slice(0, 4)
  })()
  const avgWaitH = waiting.length ? waiting.reduce((n, a) => n + (Math.min(W.end, now) - a.requested) / 3_600_000, 0) / waiting.length : null
  const totalGated = approvalMeasure(ap, W, 'approved')! + approvalMeasure(ap, W, 'rejected')! + pending
  const openApproval = (m: ApprovalMeasure, group?: string) => onOpen({
    title: `Manager approvals: ${m === 'pending' ? 'waiting for a decision' : m}`, subtitle: 'Approval-gated requests, down to the last leg', stage: 3, metric: 'created', approvals: m, dims: group ? { group } : {},
  })
  const cell = 'rounded-lg border p-3 text-left transition-colors'

  return (
    <section id="people-section" aria-label="Technician performance and manager approvals" className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
      <Panel className="flex flex-col justify-between lg:col-span-6">
        <div>
          <PanelTitle
            title={`${order === 'top5' ? 'Top 5' : 'Bottom 5'} by ${measureKey === 'resolved' ? 'resolved' : 'open backlog'}`}
            caption={`${order === 'top5' ? 'Top = highest volume.' : 'Bottom = lowest volume.'} Click a row to open its drill-down pop-up.`}
            right={
              <>
                <Seg value={measureKey} onChange={setMeasureKey} label="Measure" options={[{ value: 'resolved', label: 'Resolved' }, { value: 'backlog', label: 'Open load' }]} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">By
                  <select aria-label="Leaderboard by" value={dim} onChange={(e) => setDim(e.target.value as Dim)} className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                    {dims.map((x) => <option key={x} value={x}>{DIM_LABEL[x]}</option>)}
                  </select>
                </label>
                <Seg value={order} onChange={setOrder} label="Top or bottom" options={[{ value: 'top5', label: 'Top 5' }, { value: 'bottom5', label: 'Bottom 5' }]} />
              </>
            }
          />

          {dim === 'tech' && top3.length > 0 && open.length >= 3 && (
            <div className="mt-3.5 flex items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
              <span className="flex items-center gap-2 text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  <strong>{top3.length} technician{top3.length === 1 ? '' : 's'}</strong> hold <strong>{top3Share}%</strong> of the {open.length} open tickets -{' '}
                  <button type="button" onClick={() => { setMeasureKey('backlog'); setOrder('top5') }} className="font-semibold underline hover:text-warning">{top3[0][0]} has {top3[0][1]} open</button>.
                </span>
              </span>
            </div>
          )}

          <div className="mt-4 space-y-1.5">
            {rows.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Nothing to rank for this selection.</p>}
            {rows.map((r, i) => (
              <button key={r.key} type="button" onClick={() => openRow(r.key)} className="group flex w-full items-center gap-3 rounded-md p-2 text-xs text-foreground transition-colors hover:bg-muted/60">
                <span className="w-5 text-left font-medium tabular-nums text-muted-foreground">0{i + 1}</span>
                <div className="w-40 shrink-0 truncate text-left">
                  <div className="truncate font-semibold text-foreground">{r.key}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{[r.sub, measureKey === 'resolved' ? `${r.other} open` : `${r.other} resolved`].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div className={`h-full rounded-sm transition-all ${measureKey === 'backlog' && r.value >= maxV * 0.6 && maxV >= 5 ? 'bg-warning' : 'bg-primary/80'}`} style={{ width: `${Math.max(r.value > 0 ? 5 : 0, (r.value / maxV) * 100)}%` }} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="w-7 text-right text-sm font-bold tabular-nums text-foreground">{r.value}</span>
                  {compareOn ? <span className="hidden w-16 sm:inline-block"><DeltaBadge d={compare(measureKey, r.value, r.prev)} /></span> : <span className="hidden w-4 sm:inline-block" />}
                  <Chev className="h-3.5 w-3.5" />
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            {topGroup ? <><strong className="text-foreground">{topGroup}</strong> handled <strong className="tabular-nums text-foreground">{pct(topGroupN, resolvedIn.length)}%</strong> of all resolutions in this period ({topGroupN}/{resolvedIn.length})</> : 'Nothing was resolved in this period'}
          </span>
          <span className="tabular-nums">{assignees} active assignee{assignees === 1 ? '' : 's'}</span>
        </div>
      </Panel>

      <Panel className="flex flex-col justify-between lg:col-span-6">
        <div>
          <PanelTitle title="Approvals & decision velocity" caption="Requests that needed a manager's approval. Click a decision state or group to open its drill-down." />
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <button type="button" onClick={() => openApproval('pending')} className={`${cell} border-warning/40 bg-warning/10 hover:border-warning`}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-warning">Waiting decision</div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{pending}</div>
              <div className="mt-1 flex items-center gap-0.5 text-[11px] font-medium text-warning"><TrendingUp className="h-3 w-3" />{pending ? 'in the queue' : 'all clear'}</div>
            </button>
            <button type="button" onClick={() => openApproval('approved')} className={`${cell} border-border bg-card hover:border-primary/40`}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Approved</div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{approvedN}</div>
              <div className="mt-1 flex items-center gap-0.5 text-[11px] font-medium text-success"><CheckCircle2 className="h-3 w-3" />completed</div>
            </button>
            <button type="button" onClick={() => openApproval('rejected')} className={`${cell} border-border bg-card hover:border-primary/40`}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rejected</div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{rejectedN}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{approvedN + rejectedN ? `${pct(rejectedN, approvedN + rejectedN)}% of decided` : 'none decided'}</div>
            </button>
            <div className={`${cell} border-border bg-muted/40`}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Approval rate</div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums text-success">{formatApproval('rate', rate)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{approvedN} of {approvedN + rejectedN} decided</div>
            </div>
            <div className={`${cell} border-border bg-muted/40`}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg decision</div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums text-warning">{formatApproval('cycle', cycle)}</div>
              <div className="mt-1 flex items-center gap-0.5 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" />time to decide</div>
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">Waiting for a decision, by group</span>
              <span className="tabular-nums text-muted-foreground">{waitByGroup.length === 0 ? 'nothing waiting' : waitByGroup.length === 1 ? 'all in 1 group' : `${waitByGroup.length} groups`}</span>
            </div>
            <div className="mt-2.5 space-y-2">
              {waitByGroup.map(([g, n]) => (
                <button key={g} type="button" onClick={() => openApproval('pending', g)} className="group flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 p-2.5 text-xs transition-colors hover:border-primary/50">
                  <span className="w-28 truncate text-left font-semibold text-foreground">{g}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted"><div className="h-full rounded-sm bg-primary/85" style={{ width: `${(n / waitByGroup[0][1]) * 100}%` }} /></div>
                  <span className="w-6 text-right text-sm font-bold tabular-nums text-foreground">{n}</span>
                  <Chev className="h-4 w-4" />
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              {waitByGroup.length === 0
                ? 'Every approval request has a decision.'
                : <>Bottleneck note: <strong className="text-foreground">{waitByGroup[0][0]}</strong> has {waitByGroup[0][1]} of the {pending} pending sign-offs{avgWaitH !== null && <>, waiting <strong className="text-foreground">{formatMeasure('tat', avgWaitH)}</strong> on average</>}.</>}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>{totalGated} approval-gated request{totalGated === 1 ? '' : 's'} in this period ({approvedN + rejectedN} decided · {pending} pending)</span>
          <button type="button" onClick={() => openApproval('pending')} className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">Inspect pending requests<Chev className="text-primary" /></button>
        </div>
      </Panel>
    </section>
  )
}
