'use client'

import { useMemo } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react'
import {
  MEASURES, applyFilters, approvalMeasure, approvalRows, approvalSeries, compare, compareApproval, formatApproval, formatMeasure, inWin, measure,
  openAt, ageBucketOf, prevWindow, series, type Measure, type Win,
} from '@/lib/reporting/executive/engine'
import { SLA_TARGET, kpiText, type KpiKey } from '@/lib/reporting/executive/kpi-context'
import type { DashData } from './types'
import { DeltaBadge, Spark, SplitBar } from './ui'

const PRIMARY: KpiKey[] = ['created', 'resolved', 'backlog', 'sla']
const SECONDARY: KpiKey[] = ['breaches', 'tat', 'frt', 'approvals', 'csat', 'reopened']
const SHORT: Record<KpiKey, string> = {
  created: 'CREATED', resolved: 'RESOLVED', backlog: 'OPEN BACKLOG', sla: 'SLA COMPLIANCE', breaches: 'SLA BREACHES', tat: 'AVG RESOLUTION',
  frt: 'FIRST RESPONSE', approvals: 'APPROVALS WAITING', csat: 'CSAT (OUT OF 5)', reopened: 'RE-OPENED',
}
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0)

interface Card { key: KpiKey; value: string; delta: ReturnType<typeof compare>; spark: (number | null)[]; prevSpark: (number | null)[]; raw: number | null }

/** Two tiers: four big cards (volume, throughput, backlog, SLA) and six compact ones. Clicking any opens the drill-down pop-up. */
export function KpiScorecard({ d, baseW, active, onOpen }: { d: DashData; baseW: Win; active: KpiKey; onOpen: (k: KpiKey) => void }) {
  const { tickets, approvals, filters, now, W, P, compareOn } = d
  const base = useMemo(() => applyFilters(tickets, filters, now), [tickets, filters, now])
  const ap = useMemo(() => approvalRows(approvals, filters, now), [approvals, filters, now])
  const text = useMemo(() => kpiText(tickets, approvals, filters, W, now), [tickets, approvals, filters, W, now])

  const cards = useMemo(() => {
    const prevBase = prevWindow(baseW)
    const out: Record<string, Card> = {}
    for (const k of [...PRIMARY, ...SECONDARY]) {
      if (k === 'approvals') {
        const cur = approvalMeasure(ap, W, 'pending')
        out[k] = {
          key: k, raw: cur, value: formatApproval('pending', cur), delta: compareApproval('pending', cur, approvalMeasure(ap, P, 'pending')),
          spark: approvalSeries(ap, baseW, 'pending'), prevSpark: approvalSeries(ap, prevBase, 'pending'),
        }
      } else {
        const m = k as Measure
        const cur = measure(base, W, m)
        out[k] = { key: k, raw: cur, value: formatMeasure(m, cur), delta: compare(m, cur, measure(base, P, m)), spark: series(base, baseW, m), prevSpark: series(base, prevBase, m) }
      }
    }
    return out
  }, [base, ap, W, P, baseW])

  // proportional bars for the four big cards
  const created = base.filter((t) => inWin(t.created, W))
  const stillOpen = created.filter((t) => t.resolved === null).length
  const resolvedIn = base.filter((t) => t.resolved !== null && inWin(t.resolved, W))
  const byGroupResolved = (() => {
    const m = new Map<string, number>()
    for (const t of resolvedIn) m.set(t.group, (m.get(t.group) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3)
  })()
  const openNow = base.filter((t) => openAt(t, W.end))
  const ageSplit = (() => {
    const m = new Map<string, number>()
    for (const t of openNow) { const b = ageBucketOf(t, now); m.set(b, (m.get(b) ?? 0) + 1) }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3)
  })()
  const slaBreachedRes = resolvedIn.filter((t) => t.breached).length
  const BAR_COLORS = ['bg-success', 'bg-primary', 'bg-muted-foreground/50']
  const AGE_COLORS = ['bg-primary', 'bg-warning', 'bg-destructive']

  const bars: Record<string, React.ReactNode> = {
    created: <SplitBar parts={[{ pct: pct(created.length - stillOpen, created.length), className: 'bg-success', title: `Resolved or closed: ${created.length - stillOpen}` }, { pct: pct(stillOpen, created.length), className: 'bg-warning', title: `Still open: ${stillOpen}` }]} />,
    resolved: <SplitBar parts={byGroupResolved.map(([g, n], i) => ({ pct: pct(n, resolvedIn.length), className: BAR_COLORS[i], title: `${g}: ${n}` }))} />,
    backlog: <SplitBar parts={ageSplit.map(([b, n], i) => ({ pct: pct(n, openNow.length), className: AGE_COLORS[i], title: `${b}: ${n}` }))} />,
    sla: <SplitBar parts={[{ pct: pct(resolvedIn.length - slaBreachedRes, resolvedIn.length), className: 'bg-success', title: 'Within SLA' }, { pct: pct(slaBreachedRes, resolvedIn.length), className: 'bg-destructive', title: `Breached: ${slaBreachedRes}` }]} />,
  }

  const slaBelow = cards.sla.raw !== null && cards.sla.raw < SLA_TARGET
  const unresolvedShare = created.length ? Math.round(pct(stillOpen, created.length)) : 0
  const sideNote = (k: KpiKey): string => {
    if (k === 'created') return `${created.length} in this period`
    if (k === 'resolved') return created.length ? `${Math.round(pct(resolvedIn.length, created.length))}% resolution rate` : ''
    if (k === 'backlog') return created.length ? `${Math.round(pct(openNow.length, Math.max(1, created.length)))}% of intake` : ''
    if (k === 'sla') return `${slaBreachedRes} SLA breach${slaBreachedRes === 1 ? '' : 'es'}`
    return ''
  }

  return (
    <section id="kpi-scorecard" aria-label="Key performance indicators" className="space-y-3.5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {PRIMARY.map((k) => {
          const c = cards[k]
          const sel = active === k
          const alert = k === 'sla' && slaBelow
          return (
            <div
              key={k} role="button" tabIndex={0} onClick={() => onOpen(k)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(k) } }}
              className={`group relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sel ? 'border-primary bg-primary/5 ring-1 ring-primary' : alert ? 'border-destructive/30 bg-card hover:border-destructive/50' : 'border-border bg-card hover:border-primary/40'}`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{SHORT[k]}</span>
                  {sel ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-primary"><CheckCircle2 className="h-3.5 w-3.5" />Inspecting</span>
                  ) : alert ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-destructive"><AlertCircle className="h-3.5 w-3.5" />Below {SLA_TARGET}% target</span>
                  ) : k === 'backlog' && unresolvedShare >= 50 ? (
                    <span className="text-[11px] font-medium text-warning">{unresolvedShare}% unresolved</span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`text-3xl font-bold tabular-nums tracking-tight ${alert ? 'text-destructive' : 'text-foreground'}`}>{c.value}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
                      {compareOn && <DeltaBadge d={c.delta} />}
                      <span className="text-muted-foreground">{compareOn && c.delta ? 'vs prev period' : sideNote(k)}</span>
                    </div>
                  </div>
                  <div className="w-24 shrink-0"><Spark values={c.spark} prev={compareOn ? c.prevSpark : null} color={k === 'sla' || k === 'breaches' ? 'var(--destructive)' : k === 'resolved' ? 'var(--success)' : k === 'backlog' ? 'var(--warning)' : 'var(--primary)'} /></div>
                </div>
                <div className="mt-3.5 space-y-1.5">
                  {bars[k]}
                  <p className="truncate text-xs text-muted-foreground" title={text[k].context}>{text[k].context}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs">
                <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-primary">Pop-up breakdown<ChevronRight className="h-3.5 w-3.5" /></span>
                <span className="truncate text-[11px] text-muted-foreground" title={text[k].benchmark}>{text[k].benchmark}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-6">
          {SECONDARY.map((k) => {
            const c = cards[k]
            const sel = active === k
            return (
              <div
                key={k} role="button" tabIndex={0} onClick={() => onOpen(k)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(k) } }}
                className={`flex min-w-0 cursor-pointer flex-col justify-between p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${sel ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{SHORT[k]}</span>
                    {sel && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" title="Selected number" />}
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <span className={`text-xl font-bold tabular-nums ${k === 'breaches' ? 'text-destructive' : 'text-foreground'}`}>{c.value}</span>
                    {compareOn && <DeltaBadge d={c.delta} className="truncate" />}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground" title={text[k].context}>{text[k].context}</p>
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">Drill down<ChevronRight className="h-3 w-3" /></span>
                  <span className="text-[10px] text-muted-foreground">{MEASURES[k as Measure]?.short ?? 'Approvals'}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

