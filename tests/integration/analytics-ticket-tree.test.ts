/**
 * The fixed reports read each ticket's store (Store Master), the store's OEM, the AC details typed on the ticket, and work out
 * the NSO flag, AC Not Working % and Red Flag. Real database: stores with an OEM and Store Master details, requester accounts
 * linked to them, an AC service whose form has the AC fields, an IT service that does not go to an OEM, and tickets.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  loadTicketTreeReport, loadStoreAcReport, loadAgeBucketReport, loadTicketDetailReport,
} from '@/lib/queries/report-analytics'
import { DEFAULT_REPORT_STATUSES } from '@/lib/reporting/analytics/catalog'
import type { ProfileWithTeams } from '@/types'

vi.setConfig({ testTimeout: 60_000 })

const AC_FORM = [{
  id: 'sec1', title: 'AC', order: 0,
  fields: [
    { id: 'f_acno', type: 'select', label: 'AC Serial Number', order: 0, options: [{ label: 'Server Room AC', value: 'o_sr' }, { label: '5', value: 'o_5' }, { label: '9', value: 'o_9' }] },
    { id: 'f_oemno', type: 'text', label: 'AC OEM Ticket Number', order: 1 },
    { id: 'f_oemdate', type: 'date', label: 'AC OEM Ticket Creation Date', order: 2 },
    { id: 'f_res', type: 'select', label: 'AC resolution', order: 3, options: [{ label: 'PHASE REVERSE', value: 'r_1' }] },
  ],
}]

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

describe('fixed reports: store details, OEM, AC fields, NSO and red flag', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const made = { oem: '', stores: [] as string[], itService: '' }
  const viewer = () => ({ id: fx.admin.id, role: 'admin', org_id: fx.orgId, team_members: [] }) as unknown as ProfileWithTeams
  const common = () => ({ group: fx.teamA.id, statuses: DEFAULT_REPORT_STATUSES })
  const treeSlug = 'ticket-status-age-bucket'

  async function ticket(requester: string, service: string, o: { status?: string; assignedTo?: string | null; form?: Record<string, unknown>; ageDays?: number } = {}) {
    const r = await seedRequestLike(fx, { requesterId: requester, serviceId: service, teamId: fx.teamA.id, assignedTo: o.assignedTo ?? null, status: (o.status ?? 'in_progress') as never })
    const patch: Record<string, unknown> = {}
    if (o.form) patch.form_data = o.form
    if (o.ageDays) patch.created_at = new Date(Date.now() - o.ageDays * 86_400_000 - 3_600_000).toISOString()
    if (Object.keys(patch).length) await admin.from('requests').update(patch as never).eq('id', r.id)
    return r.id as string
  }

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    // the fixtures already raised a ticket for each team's requester; leave it out of the numbers below
    await admin.from('requests').update({ status: 'cancelled' }).in('id', [fx.requestA.id, fx.requestB.id])
    // the group's service is the AC service: it goes to an OEM and its form has the AC fields
    await admin.from('services').update({ auto_oem_routing: true, form_sections: AC_FORM, form_fields: [] }).eq('id', fx.teamA.serviceId)
    // and an IT service in the same group that does not
    const it = await admin.from('services').insert({ name: 'ZZ IT SUPPORT', slug: `zz-it-${Date.now()}`, team_id: fx.teamA.id, org_id: fx.orgId, form_fields: [], form_sections: [] }).select('id').single()
    made.itService = it.data!.id

    const oem = await admin.from('oems').insert({ org_id: fx.orgId, name: 'TEST OEM - ZZ' }).select('id').single()
    made.oem = oem.data!.id
    // ZZ1: 7 ACs, cluster ZC1, opened long ago. ZZ2: no open date yet (an NSO store). Requester B is head office staff.
    const s1 = await admin.from('stores').insert({ org_id: fx.orgId, code: 'ZZ1', name: 'ZZ1', oem_id: made.oem, cluster: 'ZC1', region: 'ZR1', ac_total: 7, ac_brand: 'DAIKIN', ac_amc_brand: 'BLUE STAR', ac_amc_vendor: 'ZZ VENDOR', zenatix: true, open_date: '2020-01-01', priority_list: 'Top 50' }).select('id').single()
    const s2 = await admin.from('stores').insert({ org_id: fx.orgId, code: 'ZZ2', name: 'ZZ2', oem_id: made.oem, cluster: 'ZC2', region: 'ZR1', ac_total: 4 }).select('id').single()
    made.stores = [s1.data!.id, s2.data!.id]
    await admin.from('profiles').update({ store_id: made.stores[0], full_name: 'ZZ1' }).eq('id', fx.requesterA.id)
    await admin.from('profiles').update({ store_id: made.stores[1], full_name: 'ZZ2' }).eq('id', fx.requesterB.id)

    // ZZ1: three open AC tickets (one is for the Server Room AC, which is not counted) and one IT ticket
    await ticket(fx.requesterA.id, fx.teamA.serviceId, { assignedTo: fx.agentA.id, ageDays: 12, form: { f_acno: 'o_5', f_oemno: 'B26093037138214', f_oemdate: day(-9), f_res: 'r_1' } })
    await ticket(fx.requesterA.id, fx.teamA.serviceId, { assignedTo: fx.agentA.id, form: { f_acno: 'o_9' } })
    await ticket(fx.requesterA.id, fx.teamA.serviceId, { assignedTo: fx.agentA.id, form: { f_acno: 'o_sr' } })
    await ticket(fx.requesterA.id, made.itService, { assignedTo: fx.agentA.id })
    // ZZ2: one open AC ticket, not assigned yet
    await ticket(fx.requesterB.id, fx.teamA.serviceId, { form: { f_acno: 'o_9' } })
  }, 120_000)

  afterAll(async () => {
    await admin.from('requests').delete().in('service_id', [fx.teamA.serviceId, made.itService])
    await admin.from('services').delete().eq('id', made.itService)
    await admin.from('profiles').update({ store_id: null }).in('id', [fx.requesterA.id, fx.requesterB.id])
    if (made.stores.length) await admin.from('stores').delete().in('id', made.stores)
    if (made.oem) await admin.from('oems').delete().eq('id', made.oem)
    await fx?.cleanup()
  }, 120_000)

  const tree = async (extra: Record<string, unknown> = {}) => {
    const res = await loadTicketTreeReport(viewer(), treeSlug, { ...common(), ...extra })
    if ('error' in res) throw new Error(res.error)
    return res
  }
  const allTickets = (t: Awaited<ReturnType<typeof tree>>) => {
    const out: { ticketNo: string; store: string; oem: string }[] = []
    const walk = (n: (typeof t.tree.roots)[number]) => { n.tickets.forEach((x) => out.push(x)); n.children.forEach(walk) }
    t.tree.roots.forEach(walk)
    return out
  }

  it('reads the store details through the requester: cluster, region and the store as the grouping, and the OEM only for AC tickets', async () => {
    const res = await tree({ layout: 'cluster-store' })
    expect(res.acAvailable).toBe(true)
    const clusters = Object.fromEntries(res.tree.roots.map((r) => [r.name, r]))
    expect(clusters.ZC1.children.map((s) => s.name)).toEqual(['ZZ1'])
    expect(clusters.ZC1.total).toBe(4) // three AC tickets and the IT ticket
    expect(clusters.ZC2.total).toBe(1)
    const byOem = await tree({ layout: 'oem-store' })
    // under the OEM: the 4 AC tickets only, the IT ticket of the same store is not listed there
    expect(byOem.layout.id).toBe('oem-store')
    expect(byOem.tree.roots.map((r) => r.name)).toEqual(['TEST OEM - ZZ'])
    expect(byOem.tree.grand.total).toBe(4)
    expect(allTickets(byOem).every((t) => t.oem === 'TEST OEM - ZZ')).toBe(true)
    // the same store's IT ticket has no OEM in the cluster layout either
    expect(allTickets(res).filter((t) => t.store === 'ZZ1' && t.oem === '').length).toBe(1)
  })

  it('reads what was typed on the AC ticket: AC number, OEM ticket number and date, resolution and the OEM age', async () => {
    const res = await loadTicketDetailReport(viewer(), 'ticket-detail-age-bucket', { ...common(), facets: { store: 'ZZ1' } })
    if ('error' in res) throw new Error(res.error)
    const withOem = res.rows.find((r) => r.oemTicketNo === 'B26093037138214')!
    expect(withOem).toMatchObject({ acNo: '5', oemTicketDate: day(-9), acResolution: 'PHASE REVERSE', oemAgeDays: 9, oemBucket: '6–10 days', service: expect.stringContaining('D-03 Service A') })
    expect(res.rows.filter((r) => r.acNo === '9')).toHaveLength(1)
    expect(res.rows.find((r) => r.service === 'ZZ IT SUPPORT')).toMatchObject({ acNo: '', oemTicketNo: '', oemAgeDays: null, oemBucket: '', oem: '' })
  })

  it('AC Not Working %: the store\'s open AC tickets without the Server Room AC, over its AC total, and the red flag above 30%', async () => {
    const res = await loadStoreAcReport(viewer(), 'store-ac-age-bucket', { ...common(), groupBy: 'cluster' })
    if ('error' in res) throw new Error(res.error)
    const stores = Object.fromEntries(res.report.groups.flatMap((g) => g.stores).map((s) => [s.store, s]))
    // ZZ1: 3 AC tickets, one for the Server Room AC: 2 count, 2 / 7 = 29%: no red flag (the IT ticket is not an AC ticket)
    expect(stores.ZZ1).toMatchObject({ acTotal: 7, openAcTickets: 2, redFlag: false, cluster: 'ZC1', zenatix: 'Yes', acBrand: 'DAIKIN', acAmcBrand: 'BLUE STAR', priorityList: 'Top 50' })
    expect(Math.round(stores.ZZ1.pct!)).toBe(29)
    // the report lists the store's AC tickets (3, the Server Room one included in the age columns)
    expect(stores.ZZ1.total).toBe(3)
    // ZZ2: 1 / 4 = 25%
    expect(stores.ZZ2).toMatchObject({ acTotal: 4, openAcTickets: 1, redFlag: false })
    expect(res.redFlagPercent).toBe(30)
  })

  it('the red flag limit can be changed, and "red flag = Yes" lists the flagged stores only', async () => {
    const strict = await loadStoreAcReport(viewer(), 'store-ac-age-bucket', { ...common(), redFlagPercent: 26, groupBy: 'none' })
    if ('error' in strict) throw new Error(strict.error)
    expect(strict.report.grand.redFlagStores).toBe(1) // ZZ1 at 29% is above 26%, ZZ2 at 25% is not
    const only = await loadStoreAcReport(viewer(), 'store-ac-age-bucket', { ...common(), redFlagPercent: 26, groupBy: 'none', facets: { redFlag: 'Yes' } })
    if ('error' in only) throw new Error(only.error)
    expect(only.report.groups[0].stores.map((s) => s.store)).toEqual(['ZZ1'])
    expect(only.facets.selection).toEqual({ redFlag: 'Yes' })
    // the percentage does not move when the viewer narrows the list: it is the store's position
    const narrowed = await loadStoreAcReport(viewer(), 'store-ac-age-bucket', { ...common(), groupBy: 'none', facets: { ageBucket: '11–20 days' } })
    if ('error' in narrowed) throw new Error(narrowed.error)
    const zz1 = narrowed.report.groups[0].stores.find((s) => s.store === 'ZZ1')!
    expect(zz1.openAcTickets).toBe(2)
    expect(zz1.total).toBe(1) // only its 12-day-old ticket is in this report
  })

  it('NSO: a store with no open date is NSO, a store that opened long ago is regular; the filter keeps the right stores', async () => {
    const res = await tree({ layout: 'cluster-store' })
    expect(res.facets.options.storeType.map((o) => o.value).sort()).toEqual(['NSO', 'Regular'])
    const nso = await tree({ layout: 'cluster-store', facets: { storeType: 'NSO' } })
    expect(allTickets(nso).map((t) => t.store)).toEqual(['ZZ2'])
    const regular = await tree({ layout: 'cluster-store', facets: { storeType: 'Regular' } })
    expect(new Set(allTickets(regular).map((t) => t.store))).toEqual(new Set(['ZZ1']))
  })

  it('linked filters: each list holds only what fits the others, and a choice that no longer fits is dropped', async () => {
    const all = await tree()
    expect(all.facets.options.cluster.map((o) => o.value)).toEqual(['ZC1', 'ZC2'])
    const zc2 = await tree({ facets: { cluster: 'ZC2' } })
    // only ZZ2's ticket is left: its store, its unassigned technician and its one age bucket
    expect(zc2.facets.options.store).toEqual([{ value: 'ZZ2', count: 1 }])
    expect(zc2.facets.options.technician).toEqual([{ value: 'Unassigned', count: 1 }])
    expect(zc2.facets.options.ageBucket).toHaveLength(1)
    // a store from the other cluster does not fit: the first choice (cluster) stays, the store is dropped
    const clash = await tree({ facets: { cluster: 'ZC2', store: 'ZZ1' } })
    expect(clash.facets.selection).toEqual({ cluster: 'ZC2' })
    // and a person who has no ticket in the chosen age bucket
    const people = await tree({ facets: { technician: 'Unassigned' } })
    expect(people.facets.options.ageBucket.map((o) => o.value)).toEqual(['0–5 days'])
  })

  it('the summary\'s "created today" columns follow the same filters', async () => {
    const res = await loadAgeBucketReport(viewer(), 'tickets-summary-age-bucket', { ...common(), facets: { cluster: 'ZC1' } })
    if ('error' in res) throw new Error(res.error)
    expect(res.ticketCount).toBe(4)
    expect(res.summary.grand.day.created).toBe(3) // today's three (the 12-day-old one is not)
    const zc2 = await loadAgeBucketReport(viewer(), 'tickets-summary-age-bucket', { ...common(), facets: { cluster: 'ZC2' } })
    if ('error' in zc2) throw new Error(zc2.error)
    expect(zc2.summary.grand.day.created).toBe(1)
  })

  it('an AC report starts from the group\'s AC services and says so when the group has none', async () => {
    const res = await loadStoreAcReport(viewer(), 'store-ac-age-bucket', { ...common() })
    if ('error' in res) throw new Error(res.error)
    expect(res.selectedServiceIds).toEqual([fx.teamA.serviceId])
    // a group with no AC service: nothing to report, not an error
    const noAc = await loadStoreAcReport(viewer(), 'store-ac-age-bucket', { group: fx.teamB.id, statuses: DEFAULT_REPORT_STATUSES })
    if ('error' in noAc) throw new Error(noAc.error)
    expect(noAc.acAvailable).toBe(false)
    expect(noAc.report.groups).toEqual([])
  })

  it('keeps the usual access rule: someone outside the group cannot open it', async () => {
    const outsider = { id: fx.agentB.id, role: 'agent', org_id: fx.orgId, team_members: [{ team_id: fx.teamB.id }] } as unknown as ProfileWithTeams
    const res = await loadTicketTreeReport(outsider, treeSlug, { ...common() })
    if ('error' in res) throw new Error(res.error)
    expect(res.team.id).toBe(fx.teamB.id) // quietly shown their own group instead
    expect(allTickets(res as never)).not.toContainEqual(expect.objectContaining({ store: 'ZZ1' }))
  })
})
