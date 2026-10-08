// The four "Priority Intelligence" cards at the top of the dashboard: what needs attention right now, in words,
// worked out from the real tickets (SLA risk, workload concentration, OEM bottleneck, approval bottleneck).
// Clicking a card opens the drill-down pop-up already pointed at the right slice (see `open`).

import {
  applyFilters, approvalMeasure, approvalRows, formatApproval, formatMeasure, measure, openAt, inWin, UNASSIGNED,
  type ApprovalRow, type Dim, type ExecTicket, type Filters, type Measure, type Win,
} from './engine'

export type Severity = 'critical' | 'warning' | 'info' | 'action'

export interface Highlight {
  id: 'sla' | 'workload' | 'oem' | 'approvals'
  category: string
  severity: Severity
  headline: string
  keyStat: string
  detail: string
  actionLabel: string
  /** where the pop-up opens */
  open: { metric: Measure; dims: { dim: Dim; value: string }[]; stage: 1 | 2 | 3; approvals?: boolean }
}

const NO_OEM = '(No OEM)'
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const i of items) { const k = key(i); const a = m.get(k); if (a) a.push(i); else m.set(k, [i]) }
  return m
}

export function highlights(
  tickets: ExecTicket[], approvals: ApprovalRow[], filters: Filters, W: Win, now: number, showPeople: boolean
): Highlight[] {
  const base = applyFilters(tickets, filters, now)
  const out: Highlight[] = []

  // 1 — SLA risk
  {
    const created = measure(base, W, 'created') ?? 0
    const breached = measure(base, W, 'breaches') ?? 0
    if (created === 0) {
      out.push({
        id: 'sla', category: 'SLA RISK', severity: 'info', headline: 'No tickets in this period', keyStat: '-',
        detail: 'Pick a longer period.', actionLabel: 'Open the breakdown', open: { metric: 'breaches', dims: [], stage: 1 },
      })
    } else {
      const rate = pct(breached, created)
      const byGroup = [...groupBy(base, (t) => t.group)]
        .map(([g, ts]) => ({ g, breaches: measure(ts, W, 'breaches') ?? 0 }))
        .filter((x) => x.breaches > 0)
        .sort((a, b) => b.breaches - a.breaches)
      const top = byGroup.slice(0, 2)
      out.push({
        id: 'sla', category: 'SLA RISK', severity: rate >= 40 ? 'critical' : rate >= 15 ? 'warning' : 'info',
        headline: `${breached} of ${created} tickets breached SLA`,
        keyStat: `${rate}% breach rate`,
        detail: top.length === 0 ? 'No breaches in this period' : `Worst: ${top.map((x) => `${x.g} (${x.breaches})`).join(' · ')}`,
        actionLabel: `Inspect ${breached} breached ticket${breached === 1 ? '' : 's'}`,
        open: { metric: 'breaches', dims: [], stage: 1 },
      })
    }
  }

  // 2 — workload concentration (people views only)
  if (showPeople) {
    const open = base.filter((t) => openAt(t, W.end))
    const perTech = [...groupBy(open.filter((t) => t.tech !== UNASSIGNED), (t) => t.tech)].map(([n, ts]) => ({ n, open: ts.length })).sort((a, b) => b.open - a.open)
    const resolvedBy = [...groupBy(base.filter((t) => t.resolved !== null && inWin(t.resolved, W) && t.tech !== UNASSIGNED), (t) => t.tech)]
      .map(([n, ts]) => ({ n, r: ts.length })).sort((a, b) => b.r - a.r)
    const top3 = perTech.slice(0, 3)
    if (open.length >= 3 && top3.length > 0) {
      const share = pct(top3.reduce((n, x) => n + x.open, 0), open.length)
      const lead = top3[0]
      const best = resolvedBy[0]
      out.push({
        id: 'workload', category: 'WORKLOAD', severity: share >= 60 ? 'warning' : 'info',
        headline: `${top3.length} technician${top3.length === 1 ? '' : 's'} hold ${share}% of ${open.length} open`,
        keyStat: `${lead.n}: ${lead.open}`,
        detail: `Most open: ${lead.n} (${lead.open})${best ? ` · Most resolved: ${best.n} (${best.r})` : ''}`,
        actionLabel: `Open ${lead.n}'s queue`,
        open: { metric: 'backlog', dims: [{ dim: 'tech', value: lead.n }], stage: 3 },
      })
    } else {
      out.push({
        id: 'workload', category: 'WORKLOAD', severity: 'info', headline: open.length === 0 ? 'No open tickets' : 'Workload is evenly spread',
        keyStat: `${open.length} open`, detail: 'No technician is overloaded', actionLabel: 'Open the backlog', open: { metric: 'backlog', dims: [], stage: 1 },
      })
    }
  }

  // 3 — OEM bottleneck (tickets of stores that have an OEM)
  {
    const oemTickets = base.filter((t) => t.brand !== NO_OEM && inWin(t.created, W))
    const brands = [...groupBy(oemTickets, (t) => t.brand)]
      .map(([b, ts]) => ({ b, created: ts.length, backlog: measure(ts, W, 'backlog') ?? 0, sla: measure(ts, W, 'sla'), breaches: measure(ts, W, 'breaches') ?? 0 }))
      .sort((a, b) => b.created - a.created)
    if (brands.length > 0) {
      const top = brands.slice(0, 2)
      const topTotal = top.reduce((n, x) => n + x.created, 0)
      out.push({
        id: 'oem', category: 'OEM / STORE EQUIPMENT', severity: 'info',
        headline: top.length === 1 ? `${top[0].b}: all ${top[0].created} OEM tickets` : `${top[0].b} & ${top[1].b}: ${pct(topTotal, oemTickets.length)}% of store tickets`,
        keyStat: `${top.reduce((n, x) => n + x.breaches, 0)} breaches`,
        detail: `Open: ${top.map((x) => `${x.b} ${x.backlog}`).join(' · ')}`,
        actionLabel: `View ${top[0].b} breakdown`,
        open: { metric: 'created', dims: [{ dim: 'brand', value: top[0].b }], stage: 2 },
      })
    } else {
      out.push({
        id: 'oem', category: 'OEM / STORE EQUIPMENT', severity: 'info', headline: 'No OEM tickets in this period', keyStat: '-',
        detail: 'Stores with an OEM show up here', actionLabel: 'Open the breakdown', open: { metric: 'created', dims: [], stage: 1 },
      })
    }
  }

  // 4 — approval bottleneck
  {
    const rows = approvalRows(approvals, filters, now)
    const pending = approvalMeasure(rows, W, 'pending') ?? 0
    const approved = approvalMeasure(rows, W, 'approved') ?? 0
    const rejected = approvalMeasure(rows, W, 'rejected') ?? 0
    const rate = approvalMeasure(rows, W, 'rate')
    if (pending > 0) {
      const waiting = rows.filter((a) => a.requested <= W.end && (a.decided === null || a.decided > W.end))
      const byGroup = [...groupBy(waiting, (a) => a.t.group)].map(([g, xs]) => ({ g, n: xs.length })).sort((a, b) => b.n - a.n)
      const avgWait = waiting.reduce((n, a) => n + (Math.min(W.end, now) - a.requested) / 3_600_000, 0) / waiting.length
      out.push({
        id: 'approvals', category: 'APPROVALS', severity: 'action',
        headline: `${pending} approval${pending === 1 ? '' : 's'} waiting for a decision`,
        keyStat: `avg ${formatMeasure('tat', avgWait)}`,
        detail: `Most: ${byGroup[0].g} (${byGroup[0].n})${rate === null ? '' : ` · ${formatApproval('rate', rate)} approved`}`,
        actionLabel: `Review ${pending} waiting approval${pending === 1 ? '' : 's'}`,
        open: { metric: 'created', dims: [], stage: 3, approvals: true },
      })
    } else {
      out.push({
        id: 'approvals', category: 'APPROVALS', severity: 'info', headline: 'No approvals waiting',
        keyStat: rate === null ? '-' : `${formatApproval('rate', rate)} approved`,
        detail: approved + rejected === 0 ? 'None decided in this period' : `${approved} approved · ${rejected} rejected`,
        actionLabel: 'Open approvals', open: { metric: 'created', dims: [], stage: 1, approvals: true },
      })
    }
  }
  return out
}
