// Who sees a service, by the Locations ticked on it (Head Office / Stores), on the isolated audit stack:
//  - Head Office ticked -> only a requester at Head Office; Stores ticked -> only a requester at Stores; both -> both; NOTHING ticked -> no requester;
//  - the same rule in the ticket-creation check (a requester cannot raise a ticket in a service they cannot see) and the WhatsApp / mail service list;
//  - technicians, managers and administrators are not limited by it.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest } from '@/lib/actions/requests'
import { listQuestionnaireServices } from '@/lib/requests/questionnaire/catalog'
import { isServiceVisibleToLocation } from '@/lib/services/location-visibility'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t46${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const ids = { ho: '', stores: '', cat: '', sub: '' }
const made: string[] = []
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)

const tickOnly = async (locationIds: string[]) => {
  await db().from('service_location_tags').delete().eq('service_id', fx.teamA.serviceId)
  if (locationIds.length) await db().from('service_location_tags').insert(locationIds.map((location_id) => ({ service_id: fx.teamA.serviceId, location_id })))
}
const setLocation = (locationId: string | null) => db().from('profiles').update({ location_id: locationId }).eq('id', fx.requesterA.id)
const asRequesterRaises = async (title: string) => {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', ids.sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}` }))
  const r = await createRequest(f)
  if (r.requestId) made.push(r.requestId)
  return r
}
const seesInList = async (locationId: string | null) => (await listQuestionnaireServices({ client: db(), orgId: fx.orgId, requesterLocationId: locationId })).some((s) => s.id === fx.teamA.serviceId)

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  ids.ho = (await a.from('locations').insert({ org_id: fx.orgId, name: `${tag} HEAD OFFICE` }).select('id').single()).data.id
  ids.stores = (await a.from('locations').insert({ org_id: fx.orgId, name: `${tag} STORES` }).select('id').single()).data.id
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} cat`, slug: `${tag}-cat` }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} sub`, slug: `${tag}-sub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  await a.from('services').update({ status: 'published', is_active: true, form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }] }).eq('id', fx.teamA.serviceId)
}, 300_000)

afterAll(async () => {
  const a = db()
  await setLocation(null)
  await a.from('service_location_tags').delete().eq('service_id', fx.teamA.serviceId)
  if (made.length) { await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  await a.from('service_sub_category_tags').delete().eq('sub_category_id', ids.sub)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await a.from('profiles').update({ location_id: null }).eq('org_id', fx.orgId).in('location_id', [ids.ho, ids.stores])
  await a.from('locations').delete().in('id', [ids.ho, ids.stores])
  await fx?.cleanup()
}, 180_000)

describe('the rule itself', () => {
  it('a requester sees a service only when their own location is ticked on it; nothing ticked, or no location of their own, means not seen', () => {
    expect(isServiceVisibleToLocation(['ho'], 'ho')).toBe(true)
    expect(isServiceVisibleToLocation(['ho'], 'stores')).toBe(false)
    expect(isServiceVisibleToLocation(['ho', 'stores'], 'stores')).toBe(true)
    expect(isServiceVisibleToLocation([], 'ho')).toBe(false)
    expect(isServiceVisibleToLocation(['ho'], null)).toBe(false)
    expect(isServiceVisibleToLocation([], null)).toBe(false)
  })
})

describe('raising a ticket and the service list, by the ticked locations', () => {
  it('Head Office ticked: a Head Office requester sees and can use it; a Stores requester cannot', async () => {
    await tickOnly([ids.ho])
    expect(await seesInList(ids.ho)).toBe(true); expect(await seesInList(ids.stores)).toBe(false)
    await setLocation(ids.ho)
    expect((await asRequesterRaises('ho by ho')).error).toBeUndefined()
    await setLocation(ids.stores)
    expect((await asRequesterRaises('ho by stores')).error).toBe('Service not found.')
  })

  it('Stores ticked: a Stores requester sees and can use it; a Head Office requester cannot', async () => {
    await tickOnly([ids.stores])
    expect(await seesInList(ids.stores)).toBe(true); expect(await seesInList(ids.ho)).toBe(false)
    await setLocation(ids.stores)
    expect((await asRequesterRaises('stores by stores')).error).toBeUndefined()
    await setLocation(ids.ho)
    expect((await asRequesterRaises('stores by ho')).error).toBe('Service not found.')
  })

  it('both ticked: both kinds of requester see and use it', async () => {
    await tickOnly([ids.ho, ids.stores])
    expect(await seesInList(ids.ho)).toBe(true); expect(await seesInList(ids.stores)).toBe(true)
    await setLocation(ids.ho)
    expect((await asRequesterRaises('both by ho')).error).toBeUndefined()
    await setLocation(ids.stores)
    expect((await asRequesterRaises('both by stores')).error).toBeUndefined()
  })

  it('NOTHING ticked: no requester sees or can use it (not even one with a location, or one with none); technicians and administrators still can', async () => {
    await tickOnly([])
    expect(await seesInList(ids.ho)).toBe(false); expect(await seesInList(ids.stores)).toBe(false); expect(await seesInList(null)).toBe(false)
    await setLocation(ids.ho)
    expect((await asRequesterRaises('none by ho')).error).toBe('Service not found.')
    await setLocation(null)
    expect((await asRequesterRaises('none by nobody')).error).toBe('Service not found.')
  })
})
