import { describe, it, expect } from 'vitest'
import {
  emptyFilters, toggleFilter, applyFilters, measure, compare, periodWindow, prevWindow, timeBuckets, rankItems, compareRows,
  approvalMeasure, joinApprovals, approvalRows, approvalsBehind, ticketsBehind, formatMeasure, heatmap, UNASSIGNED,
  type ExecTicket, type ExecApproval,
} from '@/lib/reporting/executive/engine'
import { levelFor, dimsForLevel } from '@/lib/reporting/executive/levels'
import { oemBrand, toExecTicket } from '@/lib/queries/executive-dashboard'

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = new Date(2026, 9, 8, 17, 0, 0).getTime()
const ago = (d: number, h = 0) => NOW - d * DAY - h * HOUR

let n = 0
const tk = (o: Partial<ExecTicket> = {}): ExecTicket => ({
  id: `id${++n}`, no: `CKSD-${1000 + n}`, subject: 'AC not cooling', group: 'ADMIN GROUP', tech: 'Krishan', cat: 'AC ISSUE', sub: 'COOLING', svc: 'Admin repair',
  req: 'Store A', dept: 'Stores', loc: 'STORES', store: 'Store A', state: 'Delhi', oem: 'BLUE STAR OEM - DL', brand: 'BLUE STAR', src: 'Portal',
  prio: 'medium', status: 'in_progress', created: ago(2), resolved: null, tatH: null, breached: false, csat: null, reo: [], frH: 1, ...o,
})
const done = (created: number, tatH: number, o: Partial<ExecTicket> = {}) => tk({ created, resolved: created + tatH * HOUR, tatH, status: 'resolved', ...o })

describe('measures', () => {
  const W = periodWindow('30d', NOW)
  const P = prevWindow(W)

  it('counts created, resolved and the backlog at the end of the window', () => {
    const ts = [tk({ created: ago(3) }), done(ago(5), 10), done(ago(40), 10), tk({ created: ago(45), resolved: ago(20) })]
    expect(measure(ts, W, 'created')).toBe(2)
    expect(measure(ts, W, 'resolved')).toBe(2)
    expect(measure(ts, W, 'backlog')).toBe(1)
    // the older ticket was still open at the end of the previous window
    expect(measure(ts, P, 'backlog')).toBe(1)
  })

  it('works out SLA compliance, resolution time and CSAT from resolved tickets only', () => {
    const ts = [done(ago(5), 10, { csat: 5 }), done(ago(6), 30, { breached: true, csat: 3 }), tk({ created: ago(2), breached: true })]
    expect(measure(ts, W, 'sla')).toBe(50)
    expect(measure(ts, W, 'tat')).toBe(20)
    expect(measure(ts, W, 'csat')).toBe(4)
    expect(measure(ts, W, 'breaches')).toBe(2)
  })

  it('returns null instead of 0% when nothing was resolved, and respects a minimum sample', () => {
    expect(measure([tk()], W, 'sla')).toBeNull()
    expect(measure([done(ago(3), 5)], W, 'sla', 3)).toBeNull()
    expect(formatMeasure('sla', null)).toBe('-')
  })

  it('counts re-opens by when they happened and first response by creation time', () => {
    const ts = [tk({ reo: [ago(2), ago(40)], frH: 2 }), tk({ frH: 4, created: ago(3) }), tk({ frH: null, created: ago(3) })]
    expect(measure(ts, W, 'reopened')).toBe(1)
    expect(measure(ts, W, 'frt')).toBe(3)
  })

  it('formats hours and days', () => {
    expect(formatMeasure('tat', 5.25)).toBe('5.3h')
    expect(formatMeasure('tat', 72)).toBe('3.0d')
    expect(formatMeasure('csat', 4.26)).toBe('4.3')
  })
})

describe('change against the previous period', () => {
  it('colours a rise by whether it is good for that measure', () => {
    expect(compare('resolved', 12, 10)).toMatchObject({ text: '+20%', direction: 'up', tone: 'good' })
    expect(compare('backlog', 12, 10)).toMatchObject({ direction: 'up', tone: 'bad' })
    expect(compare('created', 12, 10)).toMatchObject({ tone: 'neutral' })
    expect(compare('sla', 80, 85)).toMatchObject({ text: '-5.0 pts', tone: 'bad' })
    expect(compare('tat', 8, 10)).toMatchObject({ direction: 'down', tone: 'good' })
  })
  it('says "new" when there was nothing before, and nothing when both are empty', () => {
    expect(compare('created', 3, 0)?.text).toBe('new')
    expect(compare('created', 0, 0)).toBeNull()
    expect(compare('sla', null, 80)).toBeNull()
  })
})

describe('time windows', () => {
  it('starts a financial year on 1 April', () => {
    expect(new Date(periodWindow('fy', NOW).start)).toEqual(new Date(2026, 3, 1))
    expect(new Date(periodWindow('fy', new Date(2026, 1, 10).getTime()).start)).toEqual(new Date(2025, 3, 1))
  })
  it('compares with an equally long window just before', () => {
    const W = periodWindow('7d', NOW)
    const P = prevWindow(W)
    expect(P.end).toBe(W.start - 1)
    expect(W.end - W.start).toBe(P.end - P.start + (W.end - W.start) - (P.end - P.start))
    expect(P.end - P.start + 1).toBe(W.end - W.start + 1)
  })
  it('uses days for a month or less and weeks beyond', () => {
    expect(timeBuckets(periodWindow('30d', NOW))[0].step).toBe(1)
    expect(timeBuckets(periodWindow('90d', NOW))[0].step).toBe(7)
  })
})

describe('filters and rankings', () => {
  const W = periodWindow('30d', NOW)
  const P = prevWindow(W)
  const ts = [
    tk({ tech: 'Krishan', brand: 'LG', oem: 'LG OEM - ALL' }), tk({ tech: 'Krishan', brand: 'LG', oem: 'LG OEM - ALL' }),
    tk({ tech: 'Mohit', brand: 'DAIKIN', oem: 'DAIKIN OEM - ALL' }), tk({ tech: UNASSIGNED, brand: '(No OEM)', oem: '(No OEM)' }),
  ]

  it('adds and removes a filter value on each click', () => {
    let f = toggleFilter(emptyFilters(), 'brand', 'LG')
    expect(applyFilters(ts, f, NOW)).toHaveLength(2)
    f = toggleFilter(f, 'brand', 'DAIKIN')
    expect(applyFilters(ts, f, NOW)).toHaveLength(3)
    f = toggleFilter(toggleFilter(f, 'brand', 'LG'), 'brand', 'DAIKIN')
    expect(applyFilters(ts, f, NOW)).toHaveLength(4)
  })

  it('keeps every option of the dimension being ranked, whatever is picked in it', () => {
    const f = toggleFilter(emptyFilters(), 'tech', 'Krishan')
    const items = rankItems(ts, f, 'tech', W, P, 'created', NOW)
    expect(items.map((i) => i.key).sort()).toEqual([UNASSIGNED, 'Krishan', 'Mohit'].sort())
    expect(items[0]).toMatchObject({ key: 'Krishan', value: 2 })
  })

  it('ranks best first: highest for "good up" measures, lowest for "good down"', () => {
    const rs = [done(ago(3), 10, { tech: 'A' }), done(ago(3), 10, { tech: 'A' }), done(ago(3), 10, { tech: 'A' }), done(ago(3), 40, { tech: 'B' }), done(ago(3), 40, { tech: 'B' }), done(ago(3), 40, { tech: 'B' })]
    expect(rankItems(rs, emptyFilters(), 'tech', W, P, 'tat', NOW).map((i) => i.key)).toEqual(['A', 'B'])
    expect(rankItems(rs, emptyFilters(), 'tech', W, P, 'resolved', NOW).length).toBe(2)
  })

  it('compares OEM brands across every measure', () => {
    const rows = compareRows(ts, emptyFilters(), 'brand', W, P, NOW)
    expect(rows.find((r) => r.key === 'LG')?.created).toBe(2)
    expect(rows.find((r) => r.key === 'DAIKIN')?.backlog).toBe(1)
  })

  it('filters by backlog age on open tickets only', () => {
    const old = tk({ created: ago(25) })
    const f = toggleFilter(emptyFilters(), 'age', '21–30 days')
    expect(applyFilters([old, tk({ created: ago(2) }), done(ago(25), 5)], f, NOW)).toEqual([old])
  })
})

describe('approvals', () => {
  const W = periodWindow('30d', NOW)
  const t1 = tk({ group: 'IT' })
  const t2 = tk({ group: 'HR' })
  const as: ExecApproval[] = [
    { id: 'a1', reqId: t1.id, status: 'pending', requested: ago(3), decided: null, by: '' },
    { id: 'a2', reqId: t1.id, status: 'approved', requested: ago(6), decided: ago(5), by: 'Boss' },
    { id: 'a3', reqId: t2.id, status: 'rejected', requested: ago(6), decided: ago(5, -6), by: 'Boss' },
    { id: 'a4', reqId: 'missing', status: 'approved', requested: ago(6), decided: ago(5), by: 'Boss' },
  ]
  const rows = joinApprovals(as, [t1, t2])

  it('drops approvals whose ticket is not in view and joins the rest to their ticket', () => {
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2', 'a3'])
  })
  it('measures waiting, decided, rate and decision time', () => {
    expect(approvalMeasure(rows, W, 'pending')).toBe(1)
    expect(approvalMeasure(rows, W, 'approved')).toBe(1)
    expect(approvalMeasure(rows, W, 'rejected')).toBe(1)
    expect(approvalMeasure(rows, W, 'rate')).toBe(50)
    expect(approvalMeasure(rows, W, 'cycle')).toBeGreaterThan(0)
    expect(approvalsBehind(rows, W, 'pending').map((r) => r.id)).toEqual(['a1'])
  })
  it('follows the ticket filters (group) but not the ticket status', () => {
    const f = toggleFilter(emptyFilters(), 'group', 'IT')
    expect(approvalRows(rows, f, NOW).map((r) => r.id)).toEqual(['a1', 'a2'])
    const s = toggleFilter(emptyFilters(), 'status', 'resolved')
    expect(approvalRows(rows, s, NOW)).toHaveLength(3)
  })
})

describe('lists and heatmap', () => {
  const W = periodWindow('30d', NOW)
  it('lists the oldest open tickets first for the backlog and the newest first otherwise', () => {
    const a = tk({ created: ago(10) }); const b = tk({ created: ago(2) })
    expect(ticketsBehind([b, a], W, 'backlog').map((t) => t.id)).toEqual([a.id, b.id])
    expect(ticketsBehind([a, b], W, 'created').map((t) => t.id)).toEqual([b.id, a.id])
  })
  it('counts tickets by weekday and hour', () => {
    const { cells, max } = heatmap([tk({ created: new Date(2026, 9, 7, 10, 30).getTime() }), tk({ created: new Date(2026, 9, 7, 10, 5).getTime() })], W)
    expect(cells.get('3_10')).toBe(2)
    expect(max).toBe(2)
  })
})

describe('levels and the data rows', () => {
  it('maps every role to a level, and unknown roles to none', () => {
    expect(['user', 'agent', 'manager', 'admin', 'platform_owner'].map(levelFor)).toEqual(['requester', 'technician', 'manager', 'admin', 'owner'])
    expect(levelFor('guest')).toBeNull()
  })
  it('keeps people-based slices away from requesters', () => {
    expect(dimsForLevel('requester')).not.toContain('req')
    expect(dimsForLevel('requester')).not.toContain('dept')
    expect(dimsForLevel('admin')).toContain('oem')
  })
  it('takes the OEM brand from the OEM name', () => {
    expect(oemBrand('BLUE STAR OEM - DL')).toBe('BLUE STAR')
    expect(oemBrand('LG OEM - ALL')).toBe('LG')
    expect(oemBrand('Carrier')).toBe('Carrier')
  })
  it('builds a ticket row: OEM from the store, breach from the due time, CSAT whether sent as object or list', () => {
    const base = {
      id: 'x', request_no: 'CKSD-1', title: 'AC', status: 'resolved', priority: 'high' as const,
      created_at: new Date(ago(5)).toISOString(), resolved_at: new Date(ago(4)).toISOString(), closed_at: null,
      responded_at: new Date(ago(5, -2)).toISOString(), resolution_due_at: new Date(ago(4, 5)).toISOString(), reopen_count: 0,
      source_metadata: { created_via: 'whatsapp' }, team: { name: 'ADMIN GROUP' }, assignee: null,
      requester: { full_name: 'Store A', department: null, location: { name: 'STORES' }, store: { name: 'Store A', state: 'Delhi', oem: { name: 'BLUE STAR OEM - DL' } } },
      service: { name: 'S' }, category: { name: 'AC' }, sub_category: null, reopens: [{ created_at: new Date(ago(3)).toISOString() }],
    }
    const a = toExecTicket({ ...base, csat: { rating: 4 } }, NOW)
    expect(a).toMatchObject({ oem: 'BLUE STAR OEM - DL', brand: 'BLUE STAR', store: 'Store A', tech: UNASSIGNED, src: 'WhatsApp', csat: 4, breached: true })
    expect(a.reo).toHaveLength(1)
    expect(a.frH).toBeCloseTo(2, 1)
    expect(toExecTicket({ ...base, csat: [{ rating: 2 }, { rating: 5 }] }, NOW).csat).toBe(5)
    expect(toExecTicket({ ...base, requester: null, csat: null }, NOW)).toMatchObject({ oem: '(No OEM)', store: '(No store)', csat: null })
  })
})
