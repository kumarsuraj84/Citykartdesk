'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  APPROVAL_MEASURES, APPROVAL_ORDER, DIM_LABEL, MEASURES, MEASURE_ORDER,
  ageInDays, applyFilters, approvalMeasure, approvalRows, approvalsBehind, compare, compareApproval,
  formatApproval, formatMeasure, keyOf, measure, statusLabel, ticketsBehind,
  type ApprovalMeasure, type ApprovalRow, type Dim, type ExecTicket, type Filters, type Measure, type Win,
} from '@/lib/reporting/executive/engine'
import { dimsForLevel, type DashLevel } from '@/lib/reporting/executive/levels'
import { DeltaBadge } from './ui'
import { TicketDetailPane } from './TicketDetailPane'

export type DrillDim = Dim | 'by'
export type PathItem = { dim: DrillDim; value: string }
export type DrillScope = 'tickets' | 'approvals'

const APPROVAL_DIMS: DrillDim[] = ['group', 'tech', 'cat', 'oem', 'brand', 'store', 'state', 'prio', 'by']
const dimLabel = (d: DrillDim) => (d === 'by' ? 'Decided by' : DIM_LABEL[d])
const PAGE = 10

export function DrillModal({
  scope, initialPath, initialTicketId, initialMeasure, initialApproval, tickets, approvals, filters, now, W, P, periodText, compareOn, level, onClose, onApply,
}: {
  scope: DrillScope
  initialPath: PathItem[]
  /** open straight on one ticket (a click on a line of the ticket list) */
  initialTicketId?: string
  initialMeasure: Measure
  initialApproval: ApprovalMeasure
  tickets: ExecTicket[]
  approvals: ApprovalRow[]
  filters: Filters
  now: number
  W: Win
  P: Win
  periodText: string
  compareOn: boolean
  level: DashLevel
  onClose: () => void
  onApply: (path: { dim: Dim; value: string }[], measure: Measure) => void
}) {
  const [path, setPath] = useState<PathItem[]>(initialPath)
  const [by, setBy] = useState<string | null>(null)
  const [m, setM] = useState<Measure>(initialMeasure)
  const [am, setAm] = useState<ApprovalMeasure>(initialApproval)
  const [ticketId, setTicketId] = useState<string | null>(initialTicketId ?? null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const available: DrillDim[] = scope === 'approvals' ? APPROVAL_DIMS : dimsForLevel(level)
  const used = path.map((p) => p.dim)
  const choices = available.filter((d) => !used.includes(d))
  const effectiveBy = by === 'list' || (by === null && path.length >= 3) ? 'list' : (by && choices.includes(by as DrillDim) ? by : choices[0] ?? 'list')

  const pathDims = used.filter((d): d is Dim => d !== 'by')
  const ticketCtx = useMemo(
    () => (scope === 'tickets' ? applyFilters(tickets, filters, now, pathDims).filter((t) => path.every((p) => p.dim !== 'by' && keyOf(p.dim, t, now) === p.value)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, tickets, filters, now, path]
  )
  const approvalKey = (d: DrillDim, a: ApprovalRow) => (d === 'by' ? a.by || '(Not decided yet)' : keyOf(d, a.t, now))
  const approvalCtx = useMemo(
    () => (scope === 'approvals' ? approvalRows(approvals, filters, now, pathDims).filter((a) => path.every((p) => approvalKey(p.dim, a) === p.value)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, approvals, filters, now, path]
  )

  const pick = (value: string) => { setPath([...path, { dim: effectiveBy as DrillDim, value }]); setBy(null); setPage(0) }
  const goto = (n: number) => { setPath(path.slice(0, n)); setBy(null); setTicketId(null); setPage(0) }

  const title = scope === 'approvals' ? `Approvals - ${APPROVAL_MEASURES[am].label}` : `${MEASURES[m].label} - details`

  // ── breakdown rows ──
  type Row = { key: string; v: number | null; pv: number | null; open: number; sla: number | null; extra: string }
  let rows: Row[] = []
  if (effectiveBy !== 'list') {
    const d = effectiveBy as DrillDim
    if (scope === 'tickets') {
      const g = new Map<string, ExecTicket[]>()
      for (const t of ticketCtx) { const k = keyOf(d as Dim, t, now); const a = g.get(k); if (a) a.push(t); else g.set(k, [t]) }
      rows = [...g].map(([key, ts]) => ({ key, v: measure(ts, W, m), pv: measure(ts, P, m), open: measure(ts, W, 'backlog') ?? 0, sla: measure(ts, W, 'sla'), extra: '' }))
    } else {
      const g = new Map<string, ApprovalRow[]>()
      for (const a of approvalCtx) { const k = approvalKey(d, a); const x = g.get(k); if (x) x.push(a); else g.set(k, [a]) }
      rows = [...g].map(([key, as]) => ({ key, v: approvalMeasure(as, W, am), pv: approvalMeasure(as, P, am), open: approvalMeasure(as, W, 'pending') ?? 0, sla: approvalMeasure(as, W, 'rate'), extra: '' }))
    }
    const weakFirst = scope === 'tickets' && (m === 'sla' || m === 'csat')
    rows.sort((a, b) => (a.v === null ? 1 : b.v === null ? -1 : weakFirst ? a.v - b.v : b.v - a.v))
  }
  const maxV = Math.max(1, ...rows.map((r) => r.v ?? 0))
  const fmt = (v: number | null) => (scope === 'tickets' ? formatMeasure(m, v) : formatApproval(am, v))
  const dlt = (v: number | null, pv: number | null) => (compareOn ? (scope === 'tickets' ? compare(m, v, pv) : compareApproval(am, v, pv)) : null)

  // ── ticket / approval list ──
  const list = scope === 'tickets' ? ticketsBehind(ticketCtx, W, m) : approvalsBehind(approvalCtx, W, am)
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const pg = Math.min(page, pages - 1)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-3 sm:p-7" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-5xl rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <nav className="mt-1 flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground" aria-label="Where you are">
              <button type="button" onClick={() => goto(0)} className={path.length || ticketId ? 'font-semibold text-primary underline underline-offset-2' : 'font-semibold text-foreground'}>All {scope === 'approvals' ? 'approvals' : 'tickets'}</button>
              {path.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span aria-hidden>›</span>
                  <button type="button" onClick={() => goto(i + 1)} className={i === path.length - 1 && !ticketId ? 'font-semibold text-foreground' : 'font-semibold text-primary underline underline-offset-2'}>
                    {dimLabel(p.dim)}: {statusLabel(p.value)}
                  </button>
                </span>
              ))}
              {ticketId && <span className="inline-flex items-center gap-1"><span aria-hidden>›</span><b className="text-foreground">Ticket</b></span>}
            </nav>
          </div>
          <button type="button" onClick={onClose} aria-label="Close (Esc)" className="rounded-lg bg-muted p-1.5 text-foreground hover:bg-muted/70"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4">
          {ticketId ? (
            <TicketDetailPane id={ticketId} now={now} onBack={() => setTicketId(null)} />
          ) : (
            <>
              {/* the numbers for what is selected so far */}
              <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(125px,1fr))] gap-2">
                {scope === 'tickets'
                  ? MEASURE_ORDER.map((k) => {
                      const v = measure(ticketCtx, W, k)
                      return (
                        <button key={k} type="button" onClick={() => { setM(k); setPage(0) }} aria-pressed={k === m}
                          className={`rounded-lg border px-2.5 py-2 text-left ${k === m ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/50 hover:bg-muted'}`}>
                          <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{MEASURES[k].short}</span>
                          <span className="block text-xl font-extrabold">{formatMeasure(k, v)}</span>
                          <span className="block min-h-[15px]">{compareOn && <DeltaBadge d={compare(k, v, measure(ticketCtx, P, k))} />}</span>
                        </button>
                      )
                    })
                  : APPROVAL_ORDER.map((k) => {
                      const v = approvalMeasure(approvalCtx, W, k)
                      return (
                        <button key={k} type="button" onClick={() => { setAm(k); setPage(0) }} aria-pressed={k === am}
                          className={`rounded-lg border px-2.5 py-2 text-left ${k === am ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/50 hover:bg-muted'}`}>
                          <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{APPROVAL_MEASURES[k].label}</span>
                          <span className="block text-xl font-extrabold">{formatApproval(k, v)}</span>
                          <span className="block min-h-[15px]">{compareOn && <DeltaBadge d={compareApproval(k, v, approvalMeasure(approvalCtx, P, k))} />}</span>
                        </button>
                      )
                    })}
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <b className="mr-1 text-foreground">Break down by</b>
                {choices.map((d) => (
                  <button key={d} type="button" onClick={() => { setBy(d); setPage(0) }} aria-pressed={effectiveBy === d}
                    className={`rounded-md px-2 py-1 font-semibold ${effectiveBy === d ? 'bg-primary text-primary-foreground' : 'bg-muted/60 hover:bg-muted'}`}>{dimLabel(d)}</button>
                ))}
                <button type="button" onClick={() => { setBy('list'); setPage(0) }} aria-pressed={effectiveBy === 'list'}
                  className={`rounded-md px-2 py-1 font-semibold ${effectiveBy === 'list' ? 'bg-primary text-primary-foreground' : 'bg-muted/60 hover:bg-muted'}`}>{scope === 'approvals' ? 'Individual approvals' : 'Individual tickets'}</button>
              </div>

              {effectiveBy === 'list' ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-2 py-1.5">Ticket</th><th className="px-2 py-1.5">Subject</th><th className="px-2 py-1.5">Technician</th><th className="px-2 py-1.5">Priority</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5 text-right">Age</th><th className="px-2 py-1.5">SLA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.slice(pg * PAGE, pg * PAGE + PAGE).map((x) => {
                          const t = 't' in x ? x.t : x
                          const id = 't' in x ? x.reqId : x.id
                          return (
                            <tr key={'t' in x ? x.id : x.id} onClick={() => setTicketId(id)} className="cursor-pointer border-b border-border/60 hover:bg-muted/50">
                              <td className="px-2 py-1.5 font-semibold text-primary">{t.no}</td>
                              <td className="max-w-[260px] truncate px-2 py-1.5">{t.subject}</td>
                              <td className="px-2 py-1.5">{t.tech}</td>
                              <td className="px-2 py-1.5 capitalize">{t.prio}</td>
                              <td className="px-2 py-1.5">{'t' in x ? `${x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected'}${x.by ? ` by ${x.by}` : ''}` : statusLabel(t.status)}</td>
                              <td className="px-2 py-1.5 text-right">{ageInDays(t, now)}d</td>
                              <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t.breached ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'}`}>{t.breached ? 'Breached' : 'OK'}</span></td>
                            </tr>
                          )
                        })}
                        {list.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Nothing here for this selection.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
                    <span>{list.length} {scope === 'approvals' ? 'approvals' : 'tickets'} · page {pg + 1} of {pages} · click one for its full detail</span>
                    <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)} className="rounded-lg border border-border px-2.5 py-1 font-semibold disabled:opacity-40">‹ Prev</button>
                    <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} className="rounded-lg border border-border px-2.5 py-1 font-semibold disabled:opacity-40">Next ›</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-1 text-xs text-muted-foreground">{scope === 'tickets' && (m === 'sla' || m === 'csat') ? 'Weakest first. ' : 'Highest first. '}Click a row to go one level deeper.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-2 py-1.5">{dimLabel(effectiveBy as DrillDim)}</th>
                          <th className="min-w-[220px] px-2 py-1.5">{scope === 'tickets' ? MEASURES[m].short : APPROVAL_MEASURES[am].label}</th>
                          <th className="px-2 py-1.5 text-right">{scope === 'tickets' ? 'Open now' : 'Waiting'}</th>
                          <th className="px-2 py-1.5 text-right">{scope === 'tickets' ? 'SLA' : 'Approval rate'}</th>
                          <th className="w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.key} onClick={() => pick(r.key)} className="cursor-pointer border-b border-border/60 hover:bg-muted/50">
                            <td className="px-2 py-1.5">{statusLabel(r.key)}</td>
                            <td className="px-2 py-1.5">
                              <span className="mr-2 inline-block h-2.5 rounded bg-primary/55 align-middle" style={{ width: Math.max(2, ((r.v ?? 0) / maxV) * 120) }} />
                              <b>{fmt(r.v)}</b> <DeltaBadge d={dlt(r.v, r.pv)} className="ml-1" />
                            </td>
                            <td className="px-2 py-1.5 text-right">{r.open}</td>
                            <td className="px-2 py-1.5 text-right">{scope === 'tickets' ? formatMeasure('sla', r.sla) : formatApproval('rate', r.sla)}</td>
                            <td className="px-2 py-1.5 font-extrabold text-primary">▸</td>
                          </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nothing here for this selection.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">Period: {periodText} · the page&apos;s other filters still apply</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => onApply(path.filter((p): p is { dim: Dim; value: string } => p.dim !== 'by'), m)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted">Apply this selection to the dashboard</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted">Close</button>
          </span>
        </div>
      </div>
    </div>
  )
}
