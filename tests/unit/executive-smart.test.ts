import { describe, it, expect } from 'vitest'
import {
  emptyFilters, applyFilters, filterCount, isOpen, measure, periodWindow, quickRanges, parseDay, isoDay, joinApprovals, STATUS_PRESETS, UNASSIGNED,
  type ExecTicket, type ExecApproval, type Filters,
} from '@/lib/reporting/executive/engine'
import { highlights } from '@/lib/reporting/executive/highlights'
import { kpiText } from '@/lib/reporting/executive/kpi-context'
import { buildLifecycle } from '@/lib/reporting/executive/lifecycle'
import { explorerBase, matchesSearch, ticketsToCsv } from '@/lib/reporting/executive/explorer'
import { humanHours } from '@/lib/reporting/executive/labels'
import type { ExecTicketDetail } from '@/lib/actions/executiveDashboard'

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = new Date(2026, 9, 8, 17, 0, 0).getTime()
const ago = (d: number, h = 0) => NOW - d * DAY - h * HOUR

// The engine judges SLA from the due time, so a fixture marked breached gets a due time that has passed (or was missed when it resolved)
const withDue = (t: ExecTicket, o: Partial<ExecTicket>): ExecTicket => {
  if (o.due !== undefined) return t
  const due = t.resolved !== null ? (t.breached ? t.resolved - HOUR : t.resolved + HOUR) : (t.breached ? t.created + HOUR : NOW + DAY)
  return { ...t, due }
}
let n = 0
const tk = (o: Partial<ExecTicket> = {}): ExecTicket => withDue({
  id: `id${++n}`, no: `CKSD-${2000 + n}`, subject: 'AC not cooling', group: 'ADMIN GROUP', tech: 'Krishan', cat: 'AC ISSUE', sub: 'COOLING', svc: 'Admin repair',
  req: 'Store A', dept: 'Stores', loc: 'STORES', store: 'Store A', state: 'Delhi', oem: 'LG OEM - ALL', brand: 'LG', src: 'Portal',
  prio: 'medium', status: 'in_progress', created: ago(2), resolved: null, due: null, tatH: null, breached: false, csat: null, reo: [], frH: 1, ...o,
}, o)
const done = (created: number, tatH: number, o: Partial<ExecTicket> = {}) => tk({ created, resolved: created + tatH * HOUR, tatH, status: 'resolved', ...o })
const W = periodWindow('30d', NOW)

describe('SLA filter has three states', () => {
  const ts = [tk({ breached: true }), tk({ breached: false }), tk({ breached: false })]
  it('shows all, breached only, or within SLA only', () => {
    expect(applyFilters(ts, emptyFilters(), NOW)).toHaveLength(3)
    expect(applyFilters(ts, { ...emptyFilters(), sla: 'breached' }, NOW)).toHaveLength(1)
    expect(applyFilters(ts, { ...emptyFilters(), sla: 'ok' }, NOW)).toHaveLength(2)
  })
  it('counts it as one active filter, but not when it is "all"', () => {
    expect(filterCount(emptyFilters())).toBe(0)
    expect(filterCount({ ...emptyFilters(), sla: 'ok' })).toBe(1)
  })
})

describe('ticket search and status presets', () => {
  const ts = [tk({ subject: 'Printer jam', store: 'Delhi CP' }), tk({ subject: 'AC leak', tech: 'Mohit' }), tk({ status: 'hold_purchase_ho' }), tk({ status: 'waiting_user' }), tk({ status: 'resolved', resolved: ago(1) })]
  it('search is a filter on every number, not just the list', () => {
    expect(applyFilters(ts, { ...emptyFilters(), q: 'printer' }, NOW)).toHaveLength(1)
    expect(applyFilters(ts, { ...emptyFilters(), q: 'mohit' }, NOW)).toHaveLength(1)
    expect(applyFilters(ts, { ...emptyFilters(), q: '   ' }, NOW)).toHaveLength(5)
    expect(filterCount({ ...emptyFilters(), q: 'x' })).toBe(1)
    expect(filterCount({ ...emptyFilters(), q: '  ' })).toBe(0)
  })
  it('a status filter takes several statuses at once (all on hold)', () => {
    const hold = STATUS_PRESETS.find((p) => p.label === 'On hold')!
    const f = { ...emptyFilters(), dims: { ...emptyFilters().dims, status: hold.statuses } }
    expect(applyFilters(ts, f, NOW).map((t) => t.status).sort()).toEqual(['hold_purchase_ho', 'waiting_user'])
  })
  it('has presets for unresolved, being worked on, on hold and done', () => {
    expect(STATUS_PRESETS.map((p) => p.label)).toEqual(['All unresolved', 'Being worked on', 'On hold', 'Resolved / closed'])
    expect(STATUS_PRESETS[0].statuses).toContain('hold_purchase_ho')
    expect(STATUS_PRESETS[3].statuses).toEqual(['resolved', 'closed'])
  })
})

describe('custom dates', () => {
  it('covers both chosen days and never reaches into the future', () => {
    const w = periodWindow('custom', NOW, { start: '2026-09-01', end: '2026-09-30' })
    expect(new Date(w.start)).toEqual(new Date(2026, 8, 1))
    expect(w.end).toBe(new Date(2026, 9, 1).getTime() - 1)
    expect(periodWindow('custom', NOW, { start: '2026-10-01', end: '2026-12-31' }).end).toBe(NOW)
  })
  it('falls back to 30 days for a wrong range', () => {
    expect(periodWindow('custom', NOW, { start: '2026-10-05', end: '2026-10-01' })).toEqual(periodWindow('30d', NOW))
    expect(periodWindow('custom', NOW, { start: 'x', end: 'y' })).toEqual(periodWindow('30d', NOW))
  })
  it('reads and writes yyyy-mm-dd', () => {
    expect(isoDay(parseDay('2026-02-09'))).toBe('2026-02-09')
    expect(Number.isNaN(parseDay('2026-02-31'))).toBe(true)
  })
  it('offers ready-made ranges worked out from today', () => {
    const r = Object.fromEntries(quickRanges(NOW).map((x) => [x.label, x]))
    expect(r['Last 14 days']).toMatchObject({ start: '2026-09-25', end: '2026-10-08' })
    expect(r['This month']).toMatchObject({ start: '2026-10-01', end: '2026-10-08' })
    expect(r['Last month']).toMatchObject({ start: '2026-09-01', end: '2026-09-30' })
    expect(r['This financial quarter']).toMatchObject({ start: '2026-10-01' })
    expect(r['Last financial quarter']).toMatchObject({ start: '2026-07-01', end: '2026-09-30' })
    expect(r['This financial year'].start).toBe('2026-04-01')
    expect(r['Last financial year']).toMatchObject({ start: '2025-04-01', end: '2026-03-31' })
  })
})

describe('priority highlights', () => {
  const f: Filters = emptyFilters()
  const ts = [
    ...Array.from({ length: 6 }, (_, i) => tk({ group: 'ADMIN GROUP', tech: 'Nisha', created: ago(2 + i), breached: true })),
    ...Array.from({ length: 4 }, (_, i) => tk({ group: 'IT Group', tech: 'Rohit', created: ago(1 + i), brand: 'DAIKIN', oem: 'DAIKIN OEM - ALL' })),
    ...Array.from({ length: 4 }, (_, i) => done(ago(10 + i), 20, { group: 'IT Group', tech: 'Rohit', breached: i === 0 })),
  ]
  const approvals: ExecApproval[] = [
    { id: 'a1', reqId: ts[0].id, status: 'pending', requested: ago(3), decided: null, by: '' },
    { id: 'a2', reqId: ts[1].id, status: 'approved', requested: ago(6), decided: ago(5), by: 'Boss' },
  ]
  const hl = highlights(ts, joinApprovals(approvals, ts), f, W, NOW, true)

  it('always gives the four signals, in the design order', () => {
    expect(hl.map((h) => h.id)).toEqual(['sla', 'workload', 'oem', 'approvals'])
  })
  it('SLA risk names the groups behind the breaches and opens the breaches cohort', () => {
    const sla = hl[0]
    expect(sla.headline).toMatch(/^6 of 14 tickets breached SLA/)
    expect(sla.severity).toBe('critical')
    expect(sla.detail).toContain('ADMIN GROUP')
    expect(sla.open).toMatchObject({ metric: 'breaches', stage: 1 })
  })
  it('workload concentration points at the busiest technician', () => {
    expect(hl[1].keyStat).toBe('Nisha: 6')
    expect(hl[1].headline).toBe('2 technicians hold 100% of 10 open')
    expect(hl[1].open).toMatchObject({ metric: 'backlog', stage: 3, dims: [{ dim: 'tech', value: 'Nisha' }] })
  })
  it('OEM bottleneck is based on the stores OEM brand', () => {
    expect(hl[2].headline).toBe('LG & DAIKIN: 100% of store tickets')
    expect(hl[2].detail).toBe('Open: LG 6 · DAIKIN 4')
    expect(hl[2].open.dims[0]).toEqual({ dim: 'brand', value: 'LG' })
  })
  it('approval bottleneck counts what is waiting, and turns calm when nothing is', () => {
    expect(hl[3].headline).toBe('1 approval waiting for a decision')
    expect(hl[3].detail).toContain('ADMIN GROUP (1)')
    expect(hl[3].open.approvals).toBe(true)
    const calm = highlights(ts, [], f, W, NOW, true)[3]
    expect(calm.headline).toBe('No approvals waiting')
    expect(calm.severity).toBe('info')
  })
  it('skips the people view for requesters but still says something about workload', () => {
    const r = highlights(ts, [], f, W, NOW, false)
    expect(r.map((h) => h.id)).toEqual(['sla', 'oem', 'approvals'])
  })
  it('says so when nothing was created', () => {
    const r = highlights([], [], f, W, NOW, true)[0]
    expect(r.headline).toBe('No tickets in this period')
  })
})

describe('number card text', () => {
  const ts = [
    tk({ created: ago(3) }), tk({ created: ago(4) }),
    done(ago(6), 10, { breached: true, csat: 4 }), done(ago(7), 12, { csat: 5 }), done(ago(8), 9, { group: 'IT Group', reo: [ago(5)] }),
  ]
  const t = kpiText(ts, [], emptyFilters(), W, NOW)
  it('explains created and resolved in numbers', () => {
    expect(t.created.context).toBe('40% still open (2) · 60% resolved or closed (3)')
    expect(t.resolved.context).toMatch(/^3 Resolved \+ 0 Closed · 67% handled by ADMIN GROUP \(2\)/)
  })
  it('explains the backlog by age and status', () => {
    expect(t.backlog.context).toBe('2 aged 0–5 days (100%)')
    expect(t.backlog.benchmark).toBe('2 In Progress')
  })
  it('explains SLA, CSAT and re-opens', () => {
    expect(t.sla.context).toBe('1 breached vs 2 within SLA · Target compliance: 90%')
    expect(t.csat.context).toBe('2 rated of 3 resolved tickets')
    expect(t.reopened.context).toContain('1 ticket re-opened')
  })
  it('stays calm when there is nothing to say', () => {
    const e = kpiText([], [], emptyFilters(), W, NOW)
    expect(e.created.context).toBe('No tickets were created in this period')
    expect(e.approvals.benchmark).toBe('Nothing is waiting for a decision')
  })
})

describe('last leg lifecycle', () => {
  const detail = (o: Partial<ExecTicketDetail> = {}): ExecTicketDetail => ({
    id: 'x', no: 'CKSD-1', subject: 's', description: '', status: 'in_progress', priority: 'high', group: 'ADMIN GROUP', technician: 'Krishan', requester: 'Store A', department: '',
    store: 'Store A', oem: 'LG OEM - ALL', brand: 'LG', service: 'Repair', category: 'AC', subCategory: 'Cooling',
    created: ago(1), responded: ago(1) + 2 * HOUR, resolved: null, resolutionDue: ago(1) + 24 * HOUR, responseDue: ago(1) + 4 * HOUR, reopenCount: 0, csat: null,
    source: 'Portal', storeState: 'Delhi', closed: null, assignedAt: ago(1) + HOUR, approval: null, events: [], canNudge: true, ...o,
  })
  it('walks five steps from intake to sign-off', () => {
    const l = buildLifecycle(detail(), NOW)
    expect(l.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5])
    expect(l.steps[0]).toMatchObject({ title: 'Store intake', state: 'completed' })
    expect(l.steps[1].title).toBe('Queue routing & assignment')
    expect(l.steps[2]).toMatchObject({ state: 'completed' })
    expect(l.steps[4].state).toBe('pending')
  })
  it('uses the approval gate when the ticket had one, and marks a waiting approval as current', () => {
    const l = buildLifecycle(detail({ approval: { status: 'pending', requested: ago(1), decided: null, by: '' } }), NOW)
    expect(l.steps[1]).toMatchObject({ title: 'Manager approval gate', state: 'current' })
  })
  it('flags a late response and a missed resolution target', () => {
    const l = buildLifecycle(detail({ responded: ago(1) + 9 * HOUR, resolved: ago(1) + 30 * HOUR, resolutionDue: ago(1) + 24 * HOUR, status: 'resolved' }), NOW)
    expect(l.steps[2].state).toBe('breached')
    expect(l.steps[3].state).toBe('breached')
    expect(l.breached).toBe(true)
    expect(l.steps[4].state).toBe('completed')
  })
  it('says when nobody has picked the ticket up', () => {
    const l = buildLifecycle(detail({ technician: 'Unassigned', assignedAt: null, responded: null }), NOW)
    expect(l.steps[1].state).toBe('current')
    expect(l.steps[2].state).toBe('breached') // response target of 4h passed 20h ago
  })
  it('writes short durations', () => {
    expect(humanHours(0.25)).toBe('15m')
    expect(humanHours(5.25)).toBe('5.3h')
    expect(humanHours(72)).toBe('3.0 days')
  })
})

describe('ticket list and export', () => {
  const a = tk({ subject: 'Printer jam', store: 'Delhi CP', created: ago(2) })
  const b = done(ago(3), 5, { brand: 'DAIKIN', tech: UNASSIGNED })
  it('lists the tickets behind a number', () => {
    expect(explorerBase([a, b], [], emptyFilters(), W, NOW, 'backlog').map((t) => t.id)).toEqual([a.id])
    expect(explorerBase([a, b], [], emptyFilters(), W, NOW, 'resolved').map((t) => t.id)).toEqual([b.id])
    expect(explorerBase([a, b], [], emptyFilters(), W, NOW, 'created')).toHaveLength(2)
  })
  it('lists tickets whose approval is waiting for the approvals number', () => {
    const rows = joinApprovals([{ id: 'p', reqId: a.id, status: 'pending', requested: ago(1), decided: null, by: '' }], [a, b])
    expect(explorerBase([a, b], rows, emptyFilters(), W, NOW, 'approvals').map((t) => t.id)).toEqual([a.id])
  })
  it('searches ticket number, subject, store, group, technician and OEM', () => {
    expect(matchesSearch(a, 'printer')).toBe(true)
    expect(matchesSearch(a, 'delhi cp')).toBe(true)
    expect(matchesSearch(a, a.no.toLowerCase())).toBe(true)
    expect(matchesSearch(b, 'daikin')).toBe(true)
    expect(matchesSearch(a, 'nothing like this')).toBe(false)
    expect(matchesSearch(a, '  ')).toBe(true)
  })
  it('exports quoted CSV with a header', () => {
    const csv = ticketsToCsv([tk({ subject: 'He said "hi", twice' })], NOW)
    expect(csv.split('\n')[0]).toContain('"Ticket","Subject"')
    expect(csv).toContain('"He said ""hi"", twice"')
  })
})

describe('matches the normal dashboard\'s numbers', () => {
  it('"30 days" is today plus the 29 days before it (midnight start), the same window the normal Dashboards page uses', () => {
    const w = periodWindow('30d', NOW)
    const normalStart = new Date(NOW); normalStart.setDate(normalStart.getDate() - 29); normalStart.setHours(0, 0, 0, 0)
    expect(w.start).toBe(normalStart.getTime())
    expect(w.end).toBe(NOW)
    const w60 = periodWindow('60d', NOW)
    const start60 = new Date(NOW); start60.setDate(start60.getDate() - 59); start60.setHours(0, 0, 0, 0)
    expect(w60.start).toBe(start60.getTime())
  })
  it('counts a cancelled ticket as created but never as open work', () => {
    const cancelled = tk({ status: 'cancelled', created: ago(2) })
    const open = tk({ created: ago(3) })
    expect(measure([cancelled, open], W, 'created')).toBe(2)
    expect(measure([cancelled, open], W, 'backlog')).toBe(1)
    expect(measure([cancelled, open], W, 'resolved')).toBe(0)
    expect(isOpen(cancelled)).toBe(false)
    expect(isOpen(open)).toBe(true)
    expect(kpiText([cancelled, open], [], emptyFilters(), W, NOW).created.context).toBe('50% still open (1) · 0% resolved or closed (0) · 1 cancelled')
  })
})
