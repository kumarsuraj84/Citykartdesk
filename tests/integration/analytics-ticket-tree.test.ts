/**
 * The Ticket Status / Store wise reports read each ticket's store and the store's OEM through the requester.
 * Real database: a store with an OEM, a requester account linked to it, a ticket raised by it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { loadTicketTreeReport } from '@/lib/queries/report-analytics'
import { NO_OEM } from '@/lib/reporting/analytics/ticket-tree'
import { DEFAULT_REPORT_STATUSES } from '@/lib/reporting/analytics/catalog'
import type { ProfileWithTeams } from '@/types'

vi.setConfig({ testTimeout: 60_000 })

describe('Ticket Status / Store wise reports: store and OEM per ticket', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const made: { oem?: string; store?: string } = {}
  const viewer = () => ({ id: fx.admin.id, role: 'admin', org_id: fx.orgId, team_members: [] }) as unknown as ProfileWithTeams

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    const oem = await admin.from('oems').insert({ org_id: fx.orgId, name: 'TEST OEM - ZZ' }).select('id').single()
    made.oem = oem.data!.id
    const store = await admin.from('stores').insert({ org_id: fx.orgId, code: 'ZZ1', name: 'ZZ1', oem_id: made.oem }).select('id').single()
    made.store = store.data!.id
    // requester A is a store account (the fixtures already raised one ticket for it); requester B is not (head office staff)
    await admin.from('profiles').update({ store_id: made.store, full_name: 'ZZ1' }).eq('id', fx.requesterA.id)
    await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    await seedRequestLike(fx, { requesterId: fx.requesterB.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
  }, 90_000)

  afterAll(async () => {
    await admin.from('requests').delete().eq('team_id', fx.teamA.id).like('title', 'fixtures-d03 seedRequestLike%')
    await admin.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
    if (made.store) await admin.from('stores').delete().eq('id', made.store)
    if (made.oem) await admin.from('oems').delete().eq('id', made.oem)
    await fx?.cleanup()
  }, 90_000)

  const load = async (extra: Record<string, string | undefined> = {}) => {
    const res = await loadTicketTreeReport(viewer(), 'ticket-status-age-bucket', { group: fx.teamA.id, statuses: DEFAULT_REPORT_STATUSES, ...extra })
    if ('error' in res) throw new Error(res.error)
    return res
  }

  it('groups a store account\'s tickets under its store and OEM, and other requesters under their own name with no OEM', async () => {
    // the group's service goes to an OEM (AC servicing), so its tickets have an OEM
    await admin.from('services').update({ auto_oem_routing: true }).eq('id', fx.teamA.serviceId)
    const byOem = await load({ groupBy: 'oem' })
    expect(byOem.oemAvailable).toBe(true)
    const groups = Object.fromEntries(byOem.tree.groups.map((g) => [g.name, g]))
    expect(groups['TEST OEM - ZZ'].stores.map((s) => [s.name, s.total])).toEqual([['ZZ1', 3]])
    expect(groups[NO_OEM].total).toBe(1)
    expect(groups[NO_OEM].stores).toHaveLength(1)
    expect(groups[NO_OEM].stores[0].name).not.toBe('')
    expect(byOem.tree.grand.total).toBe(4)
  })

  it('a service that does not go to an OEM has no OEM: nothing to group by, and the report falls back to responsible', async () => {
    await admin.from('services').update({ auto_oem_routing: false }).eq('id', fx.teamA.serviceId)
    const res = await load({ groupBy: 'oem' })
    expect(res.oemAvailable).toBe(false)
    expect(res.groupBy).toBe('technician')
    // the store is still known, but no ticket carries an OEM
    expect(res.tree.grand.total).toBe(4)
    expect(res.tree.groups.flatMap((g) => g.stores.flatMap((s) => s.tickets)).every((x) => x.oem === '')).toBe(true)
    await admin.from('services').update({ auto_oem_routing: true }).eq('id', fx.teamA.serviceId)
  })

  it('groups by responsible, with the unassigned ticket last', async () => {
    const res = await load({ groupBy: 'technician' })
    expect(res.tree.groups.map((g) => g.name).slice(-1)).toEqual(['Unassigned'])
    const zz = res.tree.groups.flatMap((g) => g.stores).filter((s) => s.name === 'ZZ1').reduce((n, s) => n + s.total, 0)
    expect(zz).toBe(3)
  })

  it('"stores with at least 2 tickets" keeps the repeat-issue store only, on the store wise report', async () => {
    const res = await loadTicketTreeReport(viewer(), 'store-tickets-age-bucket', { group: fx.teamA.id, statuses: DEFAULT_REPORT_STATUSES, minTickets: '2' })
    if ('error' in res) throw new Error(res.error)
    expect(res.minTickets).toBe(2)
    expect(res.tree.grand.total).toBe(3)
    expect(res.tree.groups.flatMap((g) => g.stores.map((s) => s.name))).toEqual(['ZZ1'])
    expect(res.totalBeforeFilters).toBe(4)
    // the same filter is ignored on the report that does not offer it
    expect((await load({ minTickets: '2' })).minTickets).toBe(1)
  })

  it('Responsible and Age bucket depend on each other: each lists only what fits the other', async () => {
    // the head-office requester's unassigned ticket is made 15 days old; the others are new
    const old = await admin.from('requests').select('id').eq('requester_id', fx.requesterB.id).eq('team_id', fx.teamA.id).limit(1).single()
    await admin.from('requests').update({ created_at: new Date(Date.now() - 15 * 86_400_000).toISOString() }).eq('id', old.data!.id)

    const all = await load()
    expect(all.buckets).toEqual(['0–5 days', '11–20 days'])
    expect(all.technicians).toContain('Unassigned')
    expect(all.technicians.length).toBeGreaterThan(1)

    // only the unassigned ticket is old, so choosing the old bucket leaves Unassigned as the only person
    const oldBucket = await load({ bucket: '11–20 days' })
    expect(oldBucket.technicians).toEqual(['Unassigned'])
    expect(oldBucket.tree.grand.total).toBe(1)

    // and choosing Unassigned leaves only the old bucket
    const unassigned = await load({ technician: 'Unassigned' })
    expect(unassigned.buckets).toEqual(['11–20 days'])

    // a person with no ticket in the chosen bucket: the bucket is dropped, the person stays
    const other = all.technicians.find((t) => t !== 'Unassigned')!
    const clash = await load({ technician: other, bucket: '11–20 days' })
    expect(clash.technician).toBe(other)
    expect(clash.bucket).toBe('')
    expect(clash.buckets).toEqual(['0–5 days'])
  })

  it('keeps the usual access rule: someone outside the group cannot open it', async () => {
    const outsider = { id: fx.agentB.id, role: 'agent', org_id: fx.orgId, team_members: [{ team_id: fx.teamB.id }] } as unknown as ProfileWithTeams
    const res = await loadTicketTreeReport(outsider, 'ticket-status-age-bucket', { group: fx.teamA.id, statuses: DEFAULT_REPORT_STATUSES })
    if ('error' in res) throw new Error(res.error)
    expect(res.team.id).toBe(fx.teamB.id) // quietly shown their own group instead
    expect(res.tree.groups.flatMap((g) => g.stores.map((s) => s.name))).not.toContain('ZZ1')
  })
})
