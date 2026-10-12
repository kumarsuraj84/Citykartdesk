import { describe, it, expect } from 'vitest'
import {
  NOT_AC, NOT_SET, NO_AC_DATA, RED_FLAG, WITHIN_LIMIT, applyFilters, buildFilterOptions, emptyFilters, periodWindow, type Dim, type ExecTicket, type Filters,
} from '@/lib/reporting/executive/engine'
import { highlights } from '@/lib/reporting/executive/highlights'
import { ticketsToCsv } from '@/lib/reporting/executive/explorer'
import { toExecTicket } from '@/lib/queries/executive-dashboard'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 8, 17, 0, 0).getTime()
const ago = (d: number) => NOW - d * DAY

let n = 0
const tk = (o: Partial<ExecTicket> = {}): ExecTicket => ({
  id: `s${++n}`, no: `CKSD-${3000 + n}`, subject: 'AC not cooling', group: 'ADMIN GROUP', tech: 'Krishan', cat: 'AC ISSUE', sub: 'COOLING', svc: 'Admin repair',
  req: 'Store A', dept: 'Stores', loc: 'STORES', store: 'Store A', state: 'Delhi', oem: 'LG OEM - ALL', brand: 'LG', src: 'Portal',
  cluster: 'UP2', region: 'R4', stype: 'Regular', plist: 'ROS', acb: 'VOLTAS', amb: 'CARRIER', amv: 'VENDOR', ac: WITHIN_LIMIT, acTotal: 10, acOpen: 1, acPct: 10,
  prio: 'medium', status: 'in_progress', created: ago(2), resolved: null, due: NOW + DAY, tatH: null, breached: false, csat: null, reo: [], frH: 1, ...o,
})

// three regions with their own clusters, states, stores and technicians
const fleet = [
  tk({ store: 'DEL1', region: 'North', state: 'Delhi', cluster: 'N1', tech: 'Asha', group: 'ADMIN GROUP' }),
  tk({ store: 'DEL1', region: 'North', state: 'Delhi', cluster: 'N1', tech: 'Asha', group: 'ADMIN GROUP' }),
  tk({ store: 'LKO1', region: 'North', state: 'UP', cluster: 'N2', tech: 'Bilal', group: 'ADMIN GROUP', stype: 'NSO' }),
  tk({ store: 'MUM1', region: 'West', state: 'Maharashtra', cluster: 'W1', tech: 'Chen', group: 'IT Group', ac: RED_FLAG, acOpen: 5, acTotal: 10, acPct: 50 }),
  tk({ store: 'PUN1', region: 'West', state: 'Maharashtra', cluster: 'W2', tech: 'Dev', group: 'IT Group', acb: NOT_AC, amb: NOT_AC, amv: NOT_AC, ac: NOT_AC, brand: '(No OEM)' }),
]
const W = periodWindow('30d', NOW)
const values = (f: Filters, dim: Dim) => (buildFilterOptions(fleet, f, NOW, W).dims[dim] ?? []).map((o) => o.value).sort()
const choose = (f: Filters, dim: Dim, v: string[]): Filters => ({ ...f, dims: { ...f.dims, [dim]: v } })

describe('Store Master filters', () => {
  it('filters by region, state, cluster, store type and AC health', () => {
    expect(applyFilters(fleet, choose(emptyFilters(), 'region', ['West']), NOW)).toHaveLength(2)
    expect(applyFilters(fleet, choose(emptyFilters(), 'state', ['Delhi']), NOW)).toHaveLength(2)
    expect(applyFilters(fleet, choose(emptyFilters(), 'cluster', ['N2']), NOW)).toHaveLength(1)
    expect(applyFilters(fleet, choose(emptyFilters(), 'stype', ['NSO']), NOW).map((t) => t.store)).toEqual(['LKO1'])
    expect(applyFilters(fleet, choose(emptyFilters(), 'ac', [RED_FLAG]), NOW).map((t) => t.store)).toEqual(['MUM1'])
  })

  it('finds a ticket by its cluster or region in the search box', () => {
    expect(applyFilters(fleet, { ...emptyFilters(), q: 'w2' }, NOW).map((t) => t.store)).toEqual(['PUN1'])
    expect(applyFilters(fleet, { ...emptyFilters(), q: 'north' }, NOW)).toHaveLength(3)
  })
})

describe('linked filter lists', () => {
  it('offers every value when nothing is chosen, without the "does not apply" values', () => {
    const o = buildFilterOptions(fleet, emptyFilters(), NOW, W)
    expect(values(emptyFilters(), 'region')).toEqual(['North', 'West'])
    expect(values(emptyFilters(), 'acb')).toEqual(['VOLTAS'])
    expect(o.dims.ac?.map((x) => x.value)).not.toContain(NOT_AC)
    expect(o.dims.brand?.map((x) => x.value)).not.toContain('(No OEM)')
  })

  it('shrinks the other lists to what a choice has, and never its own list', () => {
    const north = choose(emptyFilters(), 'region', ['North'])
    expect(values(north, 'cluster')).toEqual(['N1', 'N2'])
    expect(values(north, 'state')).toEqual(['Delhi', 'UP'])
    expect(values(north, 'tech')).toEqual(['Asha', 'Bilal'])
    expect(values(north, 'group')).toEqual(['ADMIN GROUP'])
    // the region list itself still offers West, so another region can be added
    expect(values(north, 'region')).toEqual(['North', 'West'])
  })

  it('works both ways: a technician narrows the region and cluster lists', () => {
    const chen = choose(emptyFilters(), 'tech', ['Chen'])
    expect(values(chen, 'region')).toEqual(['West'])
    expect(values(chen, 'cluster')).toEqual(['W1'])
    expect(values(chen, 'ac')).toEqual([RED_FLAG])
  })

  it('keeps a ticked value in its list with a count of 0 when the other choices would hide it', () => {
    const f = choose(choose(emptyFilters(), 'region', ['North']), 'cluster', ['W1'])
    const cluster = buildFilterOptions(fleet, f, NOW, W).dims.cluster ?? []
    expect(cluster.find((c) => c.value === 'W1')?.count).toBe(0)
  })

  it('counts tickets for the chosen dates only, and gives SLA counts that follow the other choices', () => {
    const old = [...fleet, tk({ store: 'DEL1', region: 'North', created: ago(200), breached: true, due: ago(199) })]
    const o = buildFilterOptions(old, choose(emptyFilters(), 'region', ['North']), NOW, W)
    expect(o.sla).toEqual({ all: 3, breached: 0, ok: 3 })
    const wide = buildFilterOptions(old, choose(emptyFilters(), 'region', ['North']), NOW, periodWindow('custom', NOW, { start: '2026-01-01', end: '2026-10-08' }))
    expect(wide.sla.all).toBe(4)
    expect(wide.sla.breached).toBe(1)
  })
})

describe('Store Master on the ticket row', () => {
  const store = {
    code: 'STA', name: 'Store A', state: 'Delhi', cluster: 'UP2', region: 'R4', priority_list: 'ROS', ac_total: 10, ac_brand: 'DAIKIN', ac_amc_brand: 'BLUE STAR',
    ac_amc_vendor: 'COOL CO', open_date: '2020-01-01', oem: { name: 'LG OEM - ALL' },
  }
  const raw = (o: Record<string, unknown> = {}) => ({
    id: 'x', request_no: 'CKSD-9', title: 'AC', status: 'in_progress', priority: 'high' as const,
    created_at: new Date(ago(5)).toISOString(), resolved_at: null, closed_at: null, updated_at: new Date(ago(4)).toISOString(),
    responded_at: null, resolution_due_at: null, reopen_count: 0, source_metadata: null, team: { name: 'ADMIN GROUP' }, assignee: null,
    requester: { full_name: 'Store A', department: null, location: { name: 'STORES' }, store },
    service: { name: 'S', auto_oem_routing: true }, category: { name: 'AC' }, sub_category: null, reopens: [], csat: null, ...o,
  }) as unknown as Parameters<typeof toExecTicket>[0]

  it('carries the store details and the AC position, with a red flag above 30%', () => {
    const ok = toExecTicket(raw(), NOW, new Map([['STA', 3]]))
    expect(ok).toMatchObject({ cluster: 'UP2', region: 'R4', plist: 'ROS', acb: 'DAIKIN', amb: 'BLUE STAR', amv: 'COOL CO', stype: 'Regular', ac: WITHIN_LIMIT, acTotal: 10, acOpen: 3, acPct: 30 })
    const red = toExecTicket(raw(), NOW, new Map([['STA', 4]]))
    expect(red).toMatchObject({ ac: RED_FLAG, acPct: 40 })
  })

  it('treats a store opened less than 9 months ago, or without an open date, as NSO', () => {
    const recent = new Date(NOW - 100 * DAY).toISOString().slice(0, 10)
    expect(toExecTicket(raw({ requester: { full_name: 's', department: null, location: null, store: { ...store, open_date: recent } } }), NOW).stype).toBe('NSO')
    expect(toExecTicket(raw({ requester: { full_name: 's', department: null, location: null, store: { ...store, open_date: null } } }), NOW).stype).toBe('NSO')
  })

  it('says "no data" when the AC total is missing, and leaves AC details out of non-AC services', () => {
    const noTotal = toExecTicket(raw({ requester: { full_name: 's', department: null, location: null, store: { ...store, ac_total: null } } }), NOW)
    expect(noTotal).toMatchObject({ ac: NO_AC_DATA, acPct: null })
    const it = toExecTicket(raw({ service: { name: 'IT', auto_oem_routing: false } }), NOW)
    expect(it).toMatchObject({ ac: NOT_AC, acb: NOT_AC, amb: NOT_AC, amv: NOT_AC, cluster: 'UP2' })
  })

  it('has no store details for a requester who is not a store', () => {
    expect(toExecTicket(raw({ requester: null }), NOW)).toMatchObject({ cluster: NOT_SET, region: NOT_SET, stype: NOT_SET, plist: NOT_SET, ac: NO_AC_DATA })
  })
})

describe('highlights and export for stores', () => {
  it('adds a red flag box and a new store box only when there is something to show', () => {
    const none = highlights([tk()], [], emptyFilters(), W, NOW, true).map((h) => h.id)
    expect(none).not.toContain('redflag')
    expect(none).not.toContain('nso')
    const all = highlights(fleet, [], emptyFilters(), W, NOW, true)
    const red = all.find((h) => h.id === 'redflag')!
    expect(red.headline).toMatch(/1 store above 30% AC not working/)
    expect(red.detail).toContain('MUM1 (5/10)')
    expect(red.open.dims).toEqual([{ dim: 'ac', value: RED_FLAG }])
    const nso = all.find((h) => h.id === 'nso')!
    expect(nso.headline).toBe('1 ticket from 1 new store')
    expect(nso.open.dims).toEqual([{ dim: 'stype', value: 'NSO' }])
  })

  it('puts cluster, region, state, store type and AC health in the CSV', () => {
    const csv = ticketsToCsv([fleet[3]], NOW).split('\n')
    expect(csv[0]).toContain('"Cluster","Region","State","Store type"')
    expect(csv[0]).toContain('"AC health"')
    expect(csv[1]).toContain('"W1","West","Maharashtra","Regular"')
    expect(csv[1]).toContain(RED_FLAG)
  })
})
