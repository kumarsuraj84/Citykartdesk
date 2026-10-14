import { describe, it, expect } from 'vitest'
import { drawerToDrill, type BridgeEnv } from '@/lib/analytics/drill-bridge'
import { OPEN_REQUEST_STATUSES } from '@/lib/constants/requests'
import { emptyStoreFilter } from '@/lib/analytics/store-filter'

const NOW = Date.UTC(2026, 9, 14, 6, 0, 0)
const env = (over: Partial<BridgeEnv> = {}): BridgeEnv => ({
  now: NOW, period: '30d', periodWindow: { start: NOW - 30 * 86_400_000, end: NOW }, periodLabel: 'last 30 days',
  groupIds: [], groupName: (id) => ({ g1: 'IT Support', g2: 'Facilities' } as Record<string, string>)[id], techName: (id) => ({ u1: 'Mohit' } as Record<string, string>)[id],
  store: emptyStoreFilter(), ...over,
})

describe('a number clicked on the normal Dashboards page becomes a Smart Dashboard pop-up slice', () => {
  it('created / resolved in the page period use that very window', () => {
    const c = drawerToDrill({ title: 'Created', createdInPeriod: true, period: '30d' }, env())!
    expect(c.ctx).toMatchObject({ metric: 'created', stage: 1, win: { start: NOW - 30 * 86_400_000, end: NOW }, winLabel: 'last 30 days' })
    const r = drawerToDrill({ title: 'Resolved', resolvedInPeriod: true, period: '30d', sort: 'tat_desc' }, env())!
    expect(r.ctx.metric).toBe('resolved')
  })
  it('a day or a span written as dates becomes that calendar window, in the browser time zone', () => {
    const c = drawerToDrill({ title: 'Created Today', createdInPeriod: true, period: { from: '2026-10-14', to: '2026-10-14' } }, env())!
    expect(c.ctx.win).toEqual({ start: new Date('2026-10-14T00:00:00').getTime(), end: new Date('2026-10-14T23:59:59.999').getTime() })
    expect(c.ctx.winLabel).toBe('2026-10-14')
    const s = drawerToDrill({ title: 'Inflow', createdInPeriod: true, period: { from: '2026-10-08', to: '2026-10-14' } }, env())!
    expect(s.ctx.winLabel).toBe('2026-10-08 to 2026-10-14')
  })
  it('closed in a period, currently breached and first-response overdue have their own slices, measured right now', () => {
    expect(drawerToDrill({ title: 'Closed', closedInPeriod: true, period: { from: '2026-10-14', to: '2026-10-14' } }, env())!.ctx).toMatchObject({ only: 'closed' })
    expect(drawerToDrill({ title: 'Breached', slaBreached: true }, env())!.ctx).toMatchObject({ metric: 'breaches', win: { start: 0, end: NOW } })
    expect(drawerToDrill({ title: 'FRT', frtBreached: true }, env())!.ctx).toMatchObject({ metric: 'backlog', only: 'no_response', win: { start: 0, end: NOW } })
  })
  it('all open requests is the open backlog; one status is a slice by status over all time', () => {
    expect(drawerToDrill({ title: 'Open', status: [...OPEN_REQUEST_STATUSES] }, env())!.ctx).toMatchObject({ metric: 'backlog' })
    expect(drawerToDrill({ title: 'Pending Approvals', status: ['pending_approval'] }, env())!.ctx).toMatchObject({ metric: 'created', dims: { status: 'pending_approval' }, win: { start: 0, end: NOW } })
    expect(drawerToDrill({ title: 'odd', status: ['open', 'closed'] }, env())).toBeNull()
  })
  it('a priority, a group and a technician row become slices by that value', () => {
    expect(drawerToDrill({ title: 'High', priority: 'high' }, env())!.ctx.dims).toEqual({ prio: 'high' })
    expect(drawerToDrill({ title: 'IT', teamId: 'g1' }, env())!.ctx.dims).toEqual({ group: 'IT Support' })
    expect(drawerToDrill({ title: 'Mohit', assignedTo: 'u1' }, env())!.ctx.dims).toEqual({ tech: 'Mohit' })
    expect(drawerToDrill({ title: 'unknown group', teamId: 'nope' }, env())).toBeNull()
    expect(drawerToDrill({ title: 'unknown tech', assignedTo: 'nope' }, env())).toBeNull()
  })
  it('what the page has narrowed (groups, Store Master choices) stays on inside the pop-up', () => {
    const e = env({ groupIds: ['g2'], store: { ...emptyStoreFilter(), region: ['North'], ac: ['Red flag'] } })
    const c = drawerToDrill({ title: 'Created', createdInPeriod: true, period: '30d' }, e)!
    expect(c.filters.dims.group).toEqual(['Facilities'])
    expect(c.filters.dims.region).toEqual(['North'])
    expect(c.filters.dims.ac).toEqual(['Red flag'])
    // a store widget's own choice replaces the page's
    const w = drawerToDrill({ title: 'Region West', createdInPeriod: true, period: '30d', store: { ...emptyStoreFilter(), region: ['West'] } }, e)!
    expect(w.filters.dims.region).toEqual(['West'])
    // clicking a group the page has filtered out cannot widen it
    expect(drawerToDrill({ title: 'IT', teamId: 'g1' }, e)).toBeNull()
  })
  it('tasks, a period it cannot place and an unknown selected group keep the old side list (null)', () => {
    expect(drawerToDrill({ title: 'Tasks', _module: 'tasks', taskOverdue: true }, env())).toBeNull()
    expect(drawerToDrill({ title: 'Created', createdInPeriod: true, period: '90d' }, env())).toBeNull()
    expect(drawerToDrill({ title: 'Created', createdInPeriod: true, period: '30d' }, env({ groupIds: ['unknown'] }))).toBeNull()
    expect(drawerToDrill({ title: 'bad', createdInPeriod: true, period: { from: 'x', to: 'y' } }, env())).toBeNull()
    expect(drawerToDrill({ title: 'nothing recognised' }, env())).toBeNull()
  })
})
