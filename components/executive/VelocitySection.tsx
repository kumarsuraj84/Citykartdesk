'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  AGE_BUCKET_LABELS, MEASURES, RESOLVED_BUCKET, STATUS_ORDER, ageBucketOf, applyFilters, approvalRows, approvalSeries, capitalize,
  formatApproval, formatMeasure, inWin, measure, openAt, prevWindow, series, statusLabel, timeBuckets, type Measure, type Win,
} from '@/lib/reporting/executive/engine'
import type { KpiKey } from '@/lib/reporting/executive/kpi-context'
import { bucketLabel, dayLabel } from '@/lib/reporting/executive/labels'
import type { DashData, OpenDrill } from './types'
import { Chev, Panel, PanelTitle, Seg } from './ui'

const DAY = 86_400_000

function niceMax(v: number): number {
  if (v <= 4) return 4
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow
}

/** Weekly (or daily) bars for the selected number, with the previous period dashed; and the live queue by status, priority and age. */
export function VelocitySection({ d, baseW, metric, onOpen }: { d: DashData; baseW: Win; metric: KpiKey; onOpen: OpenDrill }) {
  const { tickets, approvals, filters, now, W, compareOn } = d
  const [scope, setScope] = useState<'full' | 'recent'>('full')
  const [showEmptyAges, setShowEmptyAges] = useState(false)
  const isApprovals = metric === 'approvals'
  const m: Measure = isApprovals ? 'created' : (metric as Measure)

  const base = useMemo(() => applyFilters(tickets, filters, now), [tickets, filters, now])
  const ap = useMemo(() => approvalRows(approvals, filters, now), [approvals, filters, now])
  const allBuckets = useMemo(() => timeBuckets(baseW), [baseW])
  const word = allBuckets[0]?.step === 1 ? 'day' : 'week'
  const cur = useMemo(() => (isApprovals ? approvalSeries(ap, baseW, 'pending') : series(base, baseW, m)), [isApprovals, ap, base, baseW, m])
  const prev = useMemo(() => {
    if (!compareOn) return null
    const pw = prevWindow(baseW)
    return isApprovals ? approvalSeries(ap, pw, 'pending') : series(base, pw, m)
  }, [compareOn, isApprovals, ap, base, baseW, m])

  const keep = scope === 'recent' ? Math.min(8, allBuckets.length) : allBuckets.length
  const from = allBuckets.length - keep
  const buckets = allBuckets.slice(from)
  const vals = cur.slice(from)
  const pvals = prev ? prev.slice(from) : null
  const fmt = (v: number | null) => (isApprovals ? formatApproval('pending', v) : formatMeasure(m, v))
  const rawMax = Math.max(0, ...vals.filter((x): x is number => x !== null), ...(pvals ?? []).filter((x): x is number => x !== null))
  const yMax = !isApprovals && m === 'sla' ? 100 : niceMax(rawMax)
  const ticks = [yMax, yMax * 0.75, yMax * 0.5, yMax * 0.25, 0]
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8))
  const title = isApprovals ? 'Approvals waiting' : MEASURES[m].label

  // velocity insight
  const insight = useMemo(() => {
    const lastTwo = allBuckets.slice(-2)
    const createdAll = measure(base, W, 'created') ?? 0
    const createdLast = lastTwo.reduce((n, b) => n + (measure(base, b, 'created') ?? 0), 0)
    const lastB = allBuckets[allBuckets.length - 1]
    const last14 = { start: now - 14 * DAY, end: now }
    const net = (measure(base, last14, 'created') ?? 0) - (measure(base, last14, 'resolved') ?? 0)
    return {
      share: createdAll ? Math.round((createdLast / createdAll) * 100) : 0,
      createdAll, lastLabel: lastB ? bucketLabel(lastB) : '',
      lastCreated: lastB ? measure(base, lastB, 'created') ?? 0 : 0, lastResolved: lastB ? measure(base, lastB, 'resolved') ?? 0 : 0, net,
    }
  }, [allBuckets, base, W, now])

  // queue panels
  const statusRows = useMemo(() => {
    const ts = applyFilters(tickets, filters, now).filter((t) => inWin(t.created, W))
    const c = new Map<string, number>()
    for (const t of ts) c.set(t.status, (c.get(t.status) ?? 0) + 1)
    const known = STATUS_ORDER.filter((s) => (c.get(s) ?? 0) > 0)
    const other = [...c.keys()].filter((s) => !STATUS_ORDER.includes(s))
    return { rows: [...known, ...other].map((s) => ({ s, n: c.get(s) ?? 0 })), total: ts.length }
  }, [tickets, filters, now, W])
  const prioRows = useMemo(() => {
    const ts = applyFilters(tickets, filters, now).filter((t) => inWin(t.created, W))
    return (['urgent', 'high', 'medium', 'low'] as const).map((p) => ({ p, n: ts.filter((t) => t.prio === p).length }))
  }, [tickets, filters, now, W])
  const ageRows = useMemo(() => {
    const ts = applyFilters(tickets, filters, now).filter((t) => openAt(t, W.end))
    const c = new Map<string, number>()
    for (const t of ts) { const b = ageBucketOf(t, now); c.set(b, (c.get(b) ?? 0) + 1) }
    return { rows: AGE_BUCKET_LABELS.filter((l) => l !== RESOLVED_BUCKET).map((b) => ({ b, n: c.get(b) ?? 0 })), total: ts.length }
  }, [tickets, filters, now, W])
  const lastNonEmpty = Math.max(1, ...ageRows.rows.map((r, i) => (r.n > 0 ? i + 1 : 0)))
  const visibleAges = showEmptyAges ? ageRows.rows : ageRows.rows.filter((r, i) => r.n > 0 || i < Math.min(2, lastNonEmpty))
  const hiddenEmpty = ageRows.rows.length - visibleAges.length
  const maxStatus = Math.max(1, ...statusRows.rows.map((r) => r.n))
  const maxPrio = Math.max(1, ...prioRows.map((r) => r.n))
  const maxAge = Math.max(1, ...ageRows.rows.map((r) => r.n))

  const barColor = (v: number | null) => (v === 0 || v === null ? 'bg-muted' : m === 'breaches' && !isApprovals ? 'bg-destructive/80 hover:bg-destructive' : m === 'backlog' && !isApprovals ? 'bg-warning/85 hover:bg-warning' : 'bg-primary/70 hover:bg-primary')
  const prioBar: Record<string, string> = { urgent: 'bg-destructive', high: 'bg-warning', medium: 'bg-primary/80', low: 'bg-muted-foreground/60' }

  const openBucket = (i: number) => {
    const b = buckets[i]
    onOpen({
      title: `${bucketLabel(b)} - cohort drill-down`, subtitle: `Stores, technicians and tickets for ${bucketLabel(b)}`, stage: 2,
      metric: m, approvals: isApprovals ? 'pending' : undefined, win: { start: b.start, end: b.end }, winLabel: bucketLabel(b),
    })
  }

  return (
    <section id="velocity-section" aria-label="Velocity and queue" className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
      <Panel className="flex flex-col justify-between lg:col-span-7">
        <div>
          <PanelTitle
            title={`${title} - by ${word}`}
            caption="Dashed line = the previous period. Click any number above to switch what is shown, or click a bar to open that period's drill-down."
            right={<Seg value={scope} onChange={setScope} label="Chart range" options={[{ value: 'full', label: 'Full period' }, { value: 'recent', label: `Latest ${Math.min(8, allBuckets.length)} ${word}s` }]} />}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-xs">
            <span className="text-foreground">
              <strong>Velocity insight: </strong>
              {insight.createdAll === 0
                ? 'no tickets were created in this period.'
                : <>{insight.share}% of this period&apos;s ticket volume arrived in the last 2 {word}s ({insight.lastLabel}: <strong className="tabular-nums">{insight.lastCreated} created / {insight.lastResolved} resolved</strong>).</>}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">Net backlog change: {insight.net >= 0 ? '+' : ''}{insight.net} in 14d</span>
          </div>

          <div className="relative mt-5 flex h-64">
            <div className="flex w-10 select-none flex-col justify-between pb-6 pr-2 text-right text-[11px] tabular-nums text-muted-foreground">
              {ticks.map((t, i) => <span key={i}>{fmt(t)}</span>)}
            </div>
            <div className="relative flex min-w-0 flex-1 flex-col justify-between overflow-hidden pb-6">
              <div className="pointer-events-none absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between">
                {ticks.map((_, i) => <div key={i} className="w-full border-b border-border/70" />)}
              </div>
              {pvals && pvals.filter((x) => x !== null).length > 1 && (
                <svg className="pointer-events-none absolute inset-x-2 bottom-6 top-0 z-10 h-[calc(100%-1.5rem)] w-[calc(100%-1rem)] overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                  <polyline
                    fill="none" stroke="var(--muted-foreground)" strokeWidth="1.6" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinecap="round"
                    points={pvals.map((v, i) => (v === null ? null : `${(((i + 0.5) / pvals.length) * 100).toFixed(2)},${(100 - Math.min(100, (v / yMax) * 100)).toFixed(2)}`)).filter(Boolean).join(' ')}
                  />
                </svg>
              )}
              <div className={`relative z-20 flex min-w-0 flex-1 items-end justify-between px-2 pt-2 ${buckets.length > 14 ? 'gap-0.5' : 'gap-2'}`}>
                {buckets.map((b, i) => {
                  const v = vals[i]
                  const h = Math.max(v && v > 0 ? 6 : 1.5, Math.min(100, ((v ?? 0) / yMax) * 100))
                  return (
                    <button key={b.start} type="button" onClick={() => openBucket(i)} title={`${bucketLabel(b)}: ${fmt(v)} - click to drill down`} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end focus-visible:outline-none">
                      <span className={`mb-1 whitespace-nowrap text-[11px] font-semibold tabular-nums ${buckets.length > 14 ? 'hidden group-hover:block' : v ? 'text-foreground' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`}>{fmt(v)}</span>
                      <div className={`w-full max-w-[38px] rounded-t-md transition-all duration-150 group-focus-visible:ring-2 group-focus-visible:ring-ring ${barColor(v)}`} style={{ height: `${h}%` }} />
                    </button>
                  )
                })}
              </div>
              <div className={`flex h-6 items-center justify-between border-t border-border px-2 pt-2 ${buckets.length > 14 ? 'gap-0.5' : 'gap-2'}`}>
                {buckets.map((b, i) => (
                  <div key={b.start} className="relative h-4 min-w-0 flex-1">
                    {i % labelEvery === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{dayLabel(b.start)}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary/70" />this period ({(isApprovals ? 'approvals' : MEASURES[m].short).toLowerCase()})</span>
            {compareOn && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-b border-dashed border-muted-foreground" />previous period</span>}
          </div>
          <span>Click any bar to drill into that {word}</span>
        </div>
      </Panel>

      <Panel className="flex flex-col justify-between space-y-5 lg:col-span-5">
        <div>
          <PanelTitle title="Status & live queue" caption={`Where the ${statusRows.total} tickets of this period are right now. Click a row to drill in.`} />
          <div className="mt-3 space-y-1">
            {statusRows.rows.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No tickets in this period.</p>}
            {statusRows.rows.map((r) => (
              <button key={r.s} type="button" onClick={() => onOpen({ title: `Queue status: ${statusLabel(r.s)}`, subtitle: `Drilling into tickets currently in "${statusLabel(r.s)}" across stores and technicians`, stage: 2, metric: 'created', dims: { status: r.s } })}
                className="group flex w-full items-center gap-3 rounded-md px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted/60">
                <span className="w-32 truncate text-left">{statusLabel(r.s)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted"><div className={`h-full rounded-sm ${r.s === 'resolved' || r.s === 'closed' ? 'bg-success' : r.s === 'pending_approval' || r.s === 'waiting_user' || r.s === 'hold_purchase_ho' ? 'bg-warning' : 'bg-primary/80'}`} style={{ width: `${Math.max(4, (r.n / maxStatus) * 100)}%` }} /></div>
                <span className="w-8 text-right font-semibold tabular-nums">{r.n}</span>
                <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">{statusRows.total ? Math.round((r.n / statusRows.total) * 100) : 0}%</span>
                <Chev />
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priority split</h3>
            <div className="mt-2 space-y-1">
              {prioRows.map((r) => (
                <button key={r.p} type="button" onClick={() => onOpen({ title: `${capitalize(r.p)} priority cohort`, subtitle: `Drilling into ${r.p} priority requests down to the last leg`, stage: 2, metric: 'created', dims: { prio: r.p } })}
                  className="group flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground transition-colors hover:bg-muted/60">
                  <span className="w-14 truncate text-left">{capitalize(r.p)}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted"><div className={`h-full rounded-sm ${prioBar[r.p]}`} style={{ width: `${r.n > 0 ? Math.max(6, (r.n / maxPrio) * 100) : 0}%` }} /></div>
                  <span className="w-7 text-right font-semibold tabular-nums">{r.n}</span>
                  <Chev />
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Backlog age ({ageRows.total} open)</h3>
            <div className="mt-2 space-y-1">
              {visibleAges.map((r) => (
                <button key={r.b} type="button" onClick={() => onOpen({ title: `Open backlog aged ${r.b}`, subtitle: `Stores and technicians holding open tickets aged ${r.b}`, stage: 2, metric: 'backlog', dims: { age: r.b } })}
                  className="group flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground transition-colors hover:bg-muted/60">
                  <span className="w-[4.5rem] truncate text-left">{r.b}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted"><div className={`h-full rounded-sm ${r.b === '0–5 days' ? 'bg-primary/80' : r.b === '6–10 days' ? 'bg-warning' : 'bg-destructive/80'}`} style={{ width: `${r.n > 0 ? Math.max(6, (r.n / maxAge) * 100) : 0}%` }} /></div>
                  <span className="w-7 text-right font-semibold tabular-nums">{r.n}</span>
                  <Chev />
                </button>
              ))}
              {(hiddenEmpty > 0 || showEmptyAges) && (
                <button type="button" onClick={() => setShowEmptyAges((v) => !v)} className="flex w-full items-center justify-between px-1.5 pt-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                  <span>{showEmptyAges ? 'Hide empty age buckets' : `Show ${hiddenEmpty} empty age bucket${hiddenEmpty === 1 ? '' : 's'}`}</span>
                  {showEmptyAges ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </section>
  )
}
