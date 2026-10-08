// The list of tickets "behind the numbers": which tickets the selected number stands for, the search box, and the CSV export.

import {
  ageInDays, applyFilters, approvalRows, approvalsBehind, matchesSearch, statusLabel, ticketsBehind,
  type ApprovalRow, type ExecTicket, type Filters, type Measure, type Win,
} from './engine'
import type { KpiKey } from './kpi-context'
import { dateTimeLabel } from './labels'

/** The tickets behind the selected number, narrowed by the dashboard filters. */
export function explorerBase(tickets: ExecTicket[], approvals: ApprovalRow[], filters: Filters, W: Win, now: number, metric: KpiKey): ExecTicket[] {
  if (metric === 'approvals') {
    const seen = new Set<string>()
    const out: ExecTicket[] = []
    for (const a of approvalsBehind(approvalRows(approvals, filters, now), W, 'pending')) if (!seen.has(a.t.id)) { seen.add(a.t.id); out.push(a.t) }
    return out
  }
  return ticketsBehind(applyFilters(tickets, filters, now), W, metric as Measure, filters.dims.age.length > 0)
}

export { matchesSearch }

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

export function ticketsToCsv(ts: ExecTicket[], now: number): string {
  const head = ['Ticket', 'Subject', 'Requester', 'Store', 'OEM', 'Group', 'Technician', 'Category', 'Priority', 'Status', 'Created', 'Resolved', 'Age (days)', 'SLA']
  const rows = ts.map((t) => [
    t.no, t.subject, t.req, t.store, t.oem, t.group, t.tech, t.cat, t.prio, statusLabel(t.status), dateTimeLabel(t.created), t.resolved === null ? '' : dateTimeLabel(t.resolved),
    ageInDays(t, now), t.breached ? 'Breached' : 'OK',
  ])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}
