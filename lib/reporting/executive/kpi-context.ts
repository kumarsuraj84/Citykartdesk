// The small lines under each number card ("80% currently open (120) · 20% resolved or closed (30)" and a second
// "benchmark" line), written from the real tickets so every card says something useful at a glance.

import {
  applyFilters, approvalMeasure, approvalRows, formatApproval, formatMeasure, inWin, measure, openAt, statusLabel, timeBuckets, ageBucketOf, UNASSIGNED,
  type ApprovalRow, type ExecTicket, type Filters, type Measure, type Win,
} from './engine'
import { bucketLabel } from './labels'

export type KpiKey = Measure | 'approvals'
export interface KpiText { context: string; benchmark: string }

/** The share of SLA compliance leadership is asked to hold. */
export const SLA_TARGET = 90

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const i of items) { const k = key(i); const a = m.get(k); if (a) a.push(i); else m.set(k, [i]) }
  return m
}
/** Per group of tickets: the measure's value, for groups that have one, best-first as the caller sorts. */
function perGroup(ts: ExecTicket[], w: Win, m: Measure, minN = 1): { g: string; v: number }[] {
  const out: { g: string; v: number }[] = []
  for (const [g, xs] of groupBy(ts, (t) => t.group)) { const v = measure(xs, w, m, minN); if (v !== null) out.push({ g, v }) }
  return out
}
const fmtList = (xs: { g: string; v: number }[], m: Measure, n = 3) => xs.slice(0, n).map((x) => `${x.g}: ${formatMeasure(m, x.v)}`).join(' · ')
const none = 'Nothing to compare yet'

export function kpiText(tickets: ExecTicket[], approvals: ApprovalRow[], filters: Filters, W: Win, now: number): Record<KpiKey, KpiText> {
  const base = applyFilters(tickets, filters, now)
  const buckets = timeBuckets(W)
  const word = buckets[0]?.step === 1 ? 'day' : 'week'
  const peak = (m: Measure) => {
    let best: { label: string; n: number } | null = null
    for (const b of buckets) { const n = measure(base, b, m) ?? 0; if (n > 0 && (!best || n > best.n)) best = { label: bucketLabel(b), n } }
    return best
  }

  const created = base.filter((t) => inWin(t.created, W))
  const stillOpen = created.filter((t) => t.resolved === null).length
  const resolvedIn = base.filter((t) => t.resolved !== null && inWin(t.resolved, W))
  const openNow = base.filter((t) => openAt(t, W.end))
  const peakCreated = peak('created')
  const peakResolved = peak('resolved')

  // resolved: Resolved vs Closed and the group that handled most
  const resolvedOnly = resolvedIn.filter((t) => t.status === 'resolved').length
  const topResolver = [...groupBy(resolvedIn, (t) => t.group)].map(([g, xs]) => ({ g, n: xs.length })).sort((a, b) => b.n - a.n)[0]

  // backlog: oldest buckets and statuses
  const ageCounts = [...groupBy(openNow, (t) => ageBucketOf(t, now))].map(([b, xs]) => ({ b, n: xs.length })).sort((a, b) => b.n - a.n)
  const statusCounts = [...groupBy(openNow, (t) => t.status)].map(([s, xs]) => ({ s, n: xs.length })).sort((a, b) => b.n - a.n)

  // SLA
  const slaBreachedRes = resolvedIn.filter((t) => t.breached).length
  const slaGroups = perGroup(base, W, 'sla', 3).sort((a, b) => a.v - b.v)

  // breaches
  const breachedTickets = created.filter((t) => t.breached)
  const breachByGroup = [...groupBy(breachedTickets, (t) => t.group)].map(([g, xs]) => ({ g, n: xs.length })).sort((a, b) => b.n - a.n)

  // resolution time / first response
  const tatGroups = perGroup(base, W, 'tat', 3).sort((a, b) => b.v - a.v)
  const brandTat = [...groupBy(resolvedIn.filter((t) => t.brand !== '(No OEM)'), (t) => t.brand)]
    .map(([g, xs]) => ({ g, v: measure(xs, W, 'tat', 3) })).filter((x): x is { g: string; v: number } => x.v !== null).sort((a, b) => a.v - b.v)
  const frtGroups = perGroup(base, W, 'frt', 3).sort((a, b) => b.v - a.v)

  // csat / reopened
  const rated = resolvedIn.filter((t) => t.csat !== null).length
  const csatGroups = perGroup(base, W, 'csat', 3).sort((a, b) => a.v - b.v)
  const reopenedTickets = base.filter((t) => t.reo.some((r) => inWin(r, W)))
  const reopenByGroup = [...groupBy(reopenedTickets, (t) => t.group)].map(([g, xs]) => ({ g, n: xs.length })).sort((a, b) => b.n - a.n)

  // approvals
  const ap = approvalRows(approvals, filters, now)
  const apPending = approvalMeasure(ap, W, 'pending') ?? 0
  const apApproved = approvalMeasure(ap, W, 'approved') ?? 0
  const apRejected = approvalMeasure(ap, W, 'rejected') ?? 0
  const apRate = approvalMeasure(ap, W, 'rate')
  const apWaitByGroup = [...groupBy(ap.filter((a) => a.requested <= W.end && (a.decided === null || a.decided > W.end)), (a) => a.t.group)]
    .map(([g, xs]) => ({ g, n: xs.length })).sort((a, b) => b.n - a.n)

  return {
    created: {
      context: created.length === 0 ? 'No tickets were created in this period' : `${pct(stillOpen, created.length)}% still open (${stillOpen}) · ${pct(created.length - stillOpen, created.length)}% resolved or closed (${created.length - stillOpen})`,
      benchmark: peakCreated ? `Busiest ${word}: ${peakCreated.label} (${peakCreated.n} tickets)` : none,
    },
    resolved: {
      context: resolvedIn.length === 0 ? 'Nothing was resolved in this period' : `${resolvedOnly} Resolved + ${resolvedIn.length - resolvedOnly} Closed${topResolver ? ` · ${pct(topResolver.n, resolvedIn.length)}% handled by ${topResolver.g} (${topResolver.n})` : ''}`,
      benchmark: peakResolved ? `Most resolved in a ${word}: ${peakResolved.label} (${peakResolved.n})` : none,
    },
    backlog: {
      context: openNow.length === 0 ? 'No open tickets' : ageCounts.slice(0, 2).map((a) => `${a.n} aged ${a.b} (${pct(a.n, openNow.length)}%)`).join(' · '),
      benchmark: statusCounts.length === 0 ? none : statusCounts.slice(0, 4).map((s) => `${s.n} ${statusLabel(s.s)}`).join(' · '),
    },
    sla: {
      context: resolvedIn.length === 0 ? `No resolved tickets yet · Target compliance: ${SLA_TARGET}%` : `${slaBreachedRes} breached vs ${resolvedIn.length - slaBreachedRes} within SLA · Target compliance: ${SLA_TARGET}%`,
      benchmark: slaGroups.length === 0 ? none : `Lowest: ${fmtList(slaGroups, 'sla')}`,
    },
    breaches: {
      context: breachByGroup.length === 0 ? 'No SLA breaches' : breachByGroup.slice(0, 3).map((x) => `${x.n} in ${x.g}`).join(' · '),
      benchmark: created.length === 0 ? none : `${pct(breachedTickets.length, created.length)}% of the tickets created in this period`,
    },
    tat: {
      context: tatGroups.length === 0 ? 'Not enough resolved tickets to compare groups' : `Slowest: ${fmtList(tatGroups, 'tat')}`,
      benchmark: brandTat.length >= 2 ? `${brandTat[0].g} fastest at ${formatMeasure('tat', brandTat[0].v)} · ${brandTat[brandTat.length - 1].g} slowest at ${formatMeasure('tat', brandTat[brandTat.length - 1].v)}` : none,
    },
    frt: {
      context: frtGroups.length === 0 ? 'Not enough responses to compare groups' : `Slowest: ${fmtList(frtGroups, 'frt')}`,
      benchmark: 'Time from a ticket being raised to the first reply',
    },
    approvals: {
      context: `${apPending} Waiting · ${apApproved} Approved · ${apRejected} Rejected${apRate === null ? '' : ` (${formatApproval('rate', apRate)} approval rate)`}`,
      benchmark: apWaitByGroup.length === 0 ? 'Nothing is waiting for a decision' : `Most waiting: ${apWaitByGroup[0].g} (${apWaitByGroup[0].n})`,
    },
    csat: {
      context: rated === 0 ? 'No ratings in this period' : `${rated} rated of ${resolvedIn.length} resolved tickets`,
      benchmark: csatGroups.length === 0 ? none : `Lowest: ${fmtList(csatGroups, 'csat', 2)}`,
    },
    reopened: {
      context: reopenedTickets.length === 0 ? 'No ticket was re-opened' : `${reopenedTickets.length} ticket${reopenedTickets.length === 1 ? '' : 's'} re-opened · ${pct(reopenedTickets.length, resolvedIn.length)}% of those resolved`,
      benchmark: reopenByGroup.length === 0 ? none : `Most re-opens: ${reopenByGroup[0].g} (${reopenByGroup[0].n})`,
    },
  }
}

export { UNASSIGNED }
