'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Building2, ChevronRight, SlidersHorizontal, Store, Tag, User, Wrench, X } from 'lucide-react'
import {
  MEASURES, UNASSIGNED, ageInDays, isOpen, applyFilters, approvalsBehind, TICKET_ONLY, capitalize, formatMeasure, keyOf, measure, statusLabel, ticketsBehind,
  type ApprovalRow, type Dim, type ExecTicket, type Filters, type SlaState, type Win,
} from '@/lib/reporting/executive/engine'
import { dateTimeLabel } from '@/lib/reporting/executive/labels'
import { LastLeg } from './LastLeg'
import type { DrillContext, DrillDims } from './types'
import { Seg, SlaMark } from './ui'

const PAGE = 12

interface Props {
  ctx: DrillContext
  tickets: ExecTicket[]
  approvals: ApprovalRow[]
  filters: Filters
  now: number
  W: Win
  periodText: string
  onClose: () => void
  /** copies the slice picked in the pop-up into the dashboard's filters */
  onApply: (dims: DrillDims, sla: SlaState) => void
}

function groupCount<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const i of items) { const k = key(i); const a = m.get(k); if (a) a.push(i); else m.set(k, [i]) }
  return [...m].sort((a, b) => b[1].length - a[1].length)
}
const slaOf = (ts: ExecTicket[]) => {
  const done = ts.filter((t) => t.resolved !== null)
  return done.length ? Math.round((done.filter((t) => !t.breached).length / done.length) * 100) : null
}

/** The four-leg pop-up: cohort → stores & technicians → ticket register → one ticket's last leg. */
export function DrilldownModal({ ctx, tickets, approvals, filters, now, W, periodText, onClose, onApply }: Props) {
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(ctx.stage)
  const [sel, setSel] = useState<DrillDims>(ctx.dims)
  const [ticketId, setTicketId] = useState<string | null>(ctx.ticketId ?? null)
  const [lens, setLens] = useState<SlaState>(ctx.sla ?? (ctx.metric === 'breaches' ? 'breached' : 'all'))
  const [page, setPage] = useState(0)
  const Wc = ctx.win ?? W

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const selDims = useMemo(() => (Object.keys(sel) as Dim[]).filter((k) => sel[k]), [sel])

  // everything that matches the picked slice, before the metric narrows it to "behind the number"
  const slice = useMemo(() => {
    // Approvals ignore the status / age / SLA filters (as the approvals count does): the tickets behind them are waiting in "Pending approval"
    // Every dashboard filter stays on inside the pop-up (so nothing outside the chosen group, OEM, dates... can appear); the picked slice only narrows further.
    let ts = applyFilters(tickets, filters, now, ctx.approvals ? TICKET_ONLY : []).filter((t) => selDims.every((k) => keyOf(k, t, now) === sel[k]))
    if (ctx.approvals) {
      const ids = new Set(approvalsBehind(approvals, Wc, ctx.approvals).map((a) => a.reqId))
      ts = ts.filter((t) => ids.has(t.id))
    }
    return ts
  }, [tickets, approvals, filters, now, selDims, sel, ctx.approvals, Wc])

  const behind = useMemo(() => (ctx.approvals ? slice : ticketsBehind(slice, Wc, ctx.metric, !!sel.age)), [slice, ctx.approvals, ctx.metric, Wc, sel.age])
  const cohort = useMemo(() => behind.filter((t) => (lens === 'breached' ? t.breached : lens === 'ok' ? !t.breached : true)), [behind, lens])

  const groups = useMemo(() => groupCount(cohort, (t) => t.group).slice(0, 8), [cohort])
  // OEM only applies to equipment requests: with none in this slice the OEM list (and column) give way to something that does apply
  const hasOem = useMemo(() => cohort.some((t) => t.brand !== '(No OEM)'), [cohort])
  const brands = useMemo(() => groupCount(cohort, (t) => t.brand).filter(([b]) => b !== '(No OEM)'), [cohort])
  const cats = useMemo(() => groupCount(cohort, (t) => t.cat), [cohort])
  const stores = useMemo(() => groupCount(cohort, (t) => t.store), [cohort])
  const techs = useMemo(() => groupCount(cohort, (t) => t.tech), [cohort])
  const metricValue = ctx.approvals ? String(cohort.length) : formatMeasure(ctx.metric, measure(slice, Wc, ctx.metric))
  const breachedN = cohort.filter((t) => t.breached).length
  const active = ticketId ? tickets.find((t) => t.id === ticketId) ?? null : null

  const goStage = (s: 1 | 2 | 3 | 4) => {
    if (s === 4 && !ticketId && cohort[0]) setTicketId(cohort[0].id)
    setPage(0)
    setStage(s)
  }
  const pick = (patch: DrillDims, to: 2 | 3) => { setSel((x) => ({ ...x, ...patch })); setPage(0); setStage(to) }
  const openTicket = (t: ExecTicket) => { setTicketId(t.id); setStage(4) }

  const pages = Math.max(1, Math.ceil(cohort.length / PAGE))
  const pg = Math.min(page, pages - 1)
  const title = stage === 4 && active ? `${active.no}: ${active.subject}` : ctx.title
  const steps = [
    { n: 1 as const, label: '1. Cohort breakdown', sub: sel.group || sel.brand || (ctx.approvals ? 'Approvals' : MEASURES[ctx.metric].label) },
    { n: 2 as const, label: '2. Store & technician slice', sub: sel.tech || sel.store || `${stores.length} store${stores.length === 1 ? '' : 's'} active` },
    { n: 3 as const, label: '3. Ticket register', sub: `${cohort.length} matching ticket${cohort.length === 1 ? '' : 's'}` },
    { n: 4 as const, label: '4. Last leg (lifecycle)', sub: active ? `${active.no} (${active.store})` : 'Select any ticket' },
  ]
  const box = 'rounded-lg border border-border bg-card'
  const row = 'group flex w-full items-center justify-between rounded-lg border border-border p-3 text-left text-xs transition-all hover:border-primary/50 hover:bg-primary/5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={ctx.title} className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="space-y-3 bg-primary px-6 py-4 text-primary-foreground">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {stage > 1 && (
                <button type="button" onClick={() => goStage((stage - 1) as 1 | 2 | 3)} title="Go back one leg" aria-label="Go back one leg" className="shrink-0 rounded-lg bg-white/15 p-1.5 hover:bg-white/25"><ArrowLeft className="h-4 w-4" /></button>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70"><span>Interactive drill-down</span><span aria-hidden>·</span><span>Leg {stage} of 4</span></div>
                <h2 className="truncate text-lg font-bold leading-snug">{title}</h2>
                <p className="truncate text-xs text-primary-foreground/80">{ctx.subtitle}{ctx.winLabel ? ` · ${ctx.winLabel}` : ''}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close drill-down" className="shrink-0 rounded-lg p-1.5 text-primary-foreground/80 hover:bg-white/15 hover:text-primary-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            {steps.map((s) => {
              const current = stage === s.n
              const past = stage > s.n
              const can = s.n < 4 || !!ticketId || cohort.length > 0
              return (
                <button key={s.n} type="button" disabled={!can} onClick={() => goStage(s.n)} aria-current={current ? 'step' : undefined}
                  className={`rounded-lg border px-3 py-2 text-left transition-all ${current ? 'border-white bg-white/20' : past ? 'border-white/20 bg-white/10 hover:bg-white/15' : can ? 'border-white/10 bg-white/5 text-primary-foreground/80 hover:bg-white/10' : 'cursor-not-allowed border-white/5 bg-transparent text-primary-foreground/40'}`}>
                  <div className="text-[11px] font-semibold">{s.label}</div>
                  <div className="truncate text-[11px] text-primary-foreground/70">{s.sub}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto bg-muted/30 p-6">
          {stage === 1 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className={`${box} p-4`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{ctx.approvals ? 'Approval-gated tickets' : 'Selected number'}</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{metricValue}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{ctx.approvals ? 'in this slice' : MEASURES[ctx.metric].label} · {ctx.winLabel ?? periodText}</div>
                </div>
                <div className={`${box} p-4`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Matching records</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-primary">{cohort.length}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">tickets ready to inspect</div>
                </div>
                <div className={`${box} p-4`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SLA breaches in slice</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-destructive">{breachedN}</div>
                  <div className="mt-0.5 text-xs text-destructive/80">Click a row below to drill to stores</div>
                </div>
                <div className="flex flex-col justify-between rounded-lg bg-primary p-4 text-primary-foreground">
                  <div className="text-xs font-semibold">Fast-track to the last leg</div>
                  <p className="text-[11px] text-primary-foreground/80">Jump straight to the ticket register.</p>
                  <button type="button" onClick={() => goStage(3)} className="mt-2 inline-flex items-center justify-between rounded-md bg-card px-3 py-1.5 text-xs font-bold text-primary hover:bg-card/90">
                    <span>View {cohort.length} ticket{cohort.length === 1 ? '' : 's'}</span><ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className={`${box} space-y-3 p-4`}>
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground"><Building2 className="h-4 w-4 text-primary" />Drill down by technician group</h3>
                    <span className="text-[11px] text-muted-foreground">Click a group → leg 2</span>
                  </div>
                  <div className="space-y-2">
                    {groups.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Nothing in this slice.</p>}
                    {groups.map(([g, ts]) => (
                      <button key={g} type="button" onClick={() => pick({ group: g }, 2)} className={row}>
                        <div><div className="font-semibold text-foreground">{g}</div><div className="text-[11px] text-muted-foreground">Lead: {groupCount(ts.filter((t) => t.tech !== UNASSIGNED), (t) => t.tech)[0]?.[0] ?? '-'}</div></div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <div className="text-right"><div className="font-bold text-foreground">{ts.length} total</div><div className="text-[11px] text-destructive">{ts.filter((t) => t.breached).length} breached{slaOf(ts) !== null ? ` (${slaOf(ts)}% SLA)` : ''}</div></div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`${box} space-y-3 p-4`}>
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">{hasOem ? <Wrench className="h-4 w-4 text-primary" /> : <Tag className="h-4 w-4 text-primary" />}{hasOem ? 'Drill down by store OEM equipment' : 'Drill down by category'}</h3>
                    <span className="text-[11px] text-muted-foreground">{hasOem ? 'Click an OEM → leg 2' : 'Click a category → leg 2'}</span>
                  </div>
                  <div className="space-y-2">
                    {(hasOem ? brands : cats).length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Nothing in this slice.</p>}
                    {(hasOem ? brands : cats).map(([b, ts]) => (
                      <button key={b} type="button" onClick={() => pick(hasOem ? { brand: b } : { cat: b }, 2)} className={row}>
                        <div><div className="font-semibold text-foreground">{b}</div><div className="text-[11px] text-muted-foreground">Top stores: {groupCount(ts, (t) => t.store).slice(0, 2).map((x) => x[0]).join(', ')}</div></div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <div className="text-right"><div className="font-bold text-foreground">{ts.length} total</div><div className="text-[11px] text-warning">{ts.filter(isOpen).length} open{slaOf(ts) !== null ? ` · ${slaOf(ts)}% SLA` : ''}</div></div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {stage === 2 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={`${box} space-y-3 p-4`}>
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground"><Store className="h-4 w-4 text-primary" />Impacted stores ({stores.length})</h3>
                  <span className="text-[11px] text-muted-foreground">Click a store → leg 3</span>
                </div>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {stores.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No stores in this slice.</p>}
                  {stores.map(([s, ts]) => (
                    <button key={s} type="button" onClick={() => pick({ store: s }, 3)} className={`${row} p-3`}>
                      <div className="min-w-0 text-left">
                        <div className="truncate font-semibold text-foreground">{s}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{[ts[0].state !== '(No state)' ? ts[0].state : '', ts[0].oem !== '(No OEM)' ? `OEM: ${ts[0].oem}` : '', ts[0].dept !== '(No department)' ? ts[0].dept : ''].filter(Boolean).join(' · ') || 'Store details not set'}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 tabular-nums">
                        <div className="text-right"><div className="font-bold text-foreground">{ts.length} ticket{ts.length === 1 ? '' : 's'}</div><div className="text-[11px] text-destructive">{ts.filter((t) => t.breached).length} breached · {ts.filter(isOpen).length} open</div></div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className={`${box} space-y-3 p-4`}>
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground"><User className="h-4 w-4 text-primary" />Technician queue ownership ({techs.length})</h3>
                  <span className="text-[11px] text-muted-foreground">Click a technician → leg 3</span>
                </div>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {techs.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No technicians in this slice.</p>}
                  {techs.map(([n, ts]) => {
                    const open = ts.filter(isOpen).length
                    return (
                      <button key={n} type="button" onClick={() => pick({ tech: n }, 3)} className={`${row} p-3 ${sel.tech === n ? 'border-primary bg-primary/5' : ''}`}>
                        <div className="min-w-0 text-left"><div className="truncate font-semibold text-foreground">{n}</div><div className="truncate text-[11px] text-muted-foreground">{groupCount(ts, (t) => t.group)[0]?.[0]}</div></div>
                        <div className="flex shrink-0 items-center gap-3 tabular-nums">
                          <div className="text-right"><div className="font-bold text-foreground">{open} open · {ts.length - open} resolved</div><div className="text-[11px] text-destructive">{ts.filter((t) => t.breached).length} breaches{slaOf(ts) !== null ? ` · ${slaOf(ts)}% SLA` : ''}</div></div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {stage === 3 && (
            <div className="space-y-4">
              <div className={`${box} flex flex-wrap items-center justify-between gap-2 p-3.5`}>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Select a ticket to inspect its last leg (full lifecycle &amp; store audit)</h3>
                  <p className="text-xs text-muted-foreground">Showing {cohort.length} matching ticket{cohort.length === 1 ? '' : 's'} in this drill-down path</p>
                </div>
                <Seg value={lens} onChange={(v) => { setLens(v); setPage(0) }} label="SLA lens" options={[{ value: 'all', label: 'All SLA' }, { value: 'breached', label: 'Breached only' }, { value: 'ok', label: 'SLA OK' }]} />
              </div>
              <div className={`${box} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="border-b border-border bg-muted text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <tr><th className="py-3 pl-4 pr-2">Ticket</th><th className="px-2 py-3">Store &amp; subject</th><th className="px-2 py-3">Group / tech</th>{hasOem && <th className="px-2 py-3">OEM</th>}<th className="px-2 py-3">Status</th><th className="px-2 py-3 text-right">SLA / age</th><th className="py-3 pl-2 pr-4 text-right">Last leg</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border text-xs">
                      {cohort.slice(pg * PAGE, pg * PAGE + PAGE).map((t) => (
                        <tr key={t.id} onClick={() => openTicket(t)} className="group cursor-pointer transition-colors hover:bg-primary/5">
                          <td className="whitespace-nowrap py-3 pl-4 pr-2 font-bold tabular-nums text-primary">{t.no}</td>
                          <td className="max-w-[220px] px-2 py-3"><div className="truncate font-semibold text-foreground">{t.subject}</div><div className="truncate text-[11px] text-muted-foreground">Store: {t.store} · Created {dateTimeLabel(t.created)}</div></td>
                          <td className="whitespace-nowrap px-2 py-3"><div className="font-medium text-foreground">{t.group}</div><div className="text-[11px] text-muted-foreground">{t.tech}</div></td>
                          {hasOem && <td className="whitespace-nowrap px-2 py-3 font-medium text-foreground">{t.brand === '(No OEM)' ? '-' : t.brand}</td>}
                          <td className="whitespace-nowrap px-2 py-3"><span className="font-medium text-foreground">{statusLabel(t.status)}</span><div className="text-[11px] text-muted-foreground">Priority: {capitalize(t.prio)}</div></td>
                          <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums"><SlaMark breached={t.breached} /><div className="text-[11px] text-muted-foreground">Age {ageInDays(t, now)}d{t.frH !== null ? ` · resp ${t.frH.toFixed(1)}h` : ''}</div></td>
                          <td className="whitespace-nowrap py-3 pl-2 pr-4 text-right"><span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">Inspect<ChevronRight className="h-4 w-4" /></span></td>
                        </tr>
                      ))}
                      {cohort.length === 0 && <tr><td colSpan={hasOem ? 7 : 6} className="py-10 text-center text-xs text-muted-foreground">No tickets match this slice.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {cohort.length > PAGE && (
                  <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                    <span>page {pg + 1} of {pages}</span>
                    <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)} className="rounded-lg border border-border px-2.5 py-1 font-semibold disabled:opacity-40">‹ Prev</button>
                    <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} className="rounded-lg border border-border px-2.5 py-1 font-semibold disabled:opacity-40">Next ›</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {stage === 4 && (ticketId ? <LastLeg id={ticketId} now={now} /> : <p className="py-10 text-center text-sm text-muted-foreground">Pick a ticket in leg 3 to see its last leg.</p>)}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3.5 text-xs">
          <button type="button" onClick={() => { onApply(sel, lens); onClose() }} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 font-semibold text-foreground transition-colors hover:bg-muted">
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />Apply this slice to the dashboard filters
          </button>
          <div className="flex items-center gap-2">
            {stage < 4 && (
              <button type="button" onClick={() => goStage((stage + 1) as 2 | 3 | 4)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                <span>{stage === 1 ? 'Next: store & technician slice (leg 2)' : stage === 2 ? `Next: view ${cohort.length} ticket${cohort.length === 1 ? '' : 's'} (leg 3)` : 'Next: inspect the last leg (leg 4)'}</span><ChevronRight className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-lg bg-foreground px-4 py-2 font-semibold text-background transition-colors hover:bg-foreground/90">Close pop-up</button>
          </div>
        </div>
      </div>
    </div>
  )
}

