// OEM by type: a store has one AC OEM and one Genset OEM; a category can send its tickets to the store's OEM of a type. Runs on the isolated audit stack.
//  - the database refuses an OEM of the wrong type in a slot, so a store can never have two AC OEMs;
//  - the admin actions set only the slot of the OEM's own type and say which stores they replaced;
//  - tickets: a Genset category goes to the store's Genset OEM, an AC category to its AC OEM, a normal category to nobody; a store without the needed OEM
//    leaves the ticket open with an internal note, and a ticket is never sent to an OEM of the other type.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
const send = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/send', () => ({ sendEmail: send }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest } from '@/lib/actions/requests'
import { createOem, updateOem, setOemStores } from '@/lib/actions/admin/oems'

vi.setConfig({ testTimeout: 180_000 })
const admin = () => getAdmin()
const tag = `t31-${Date.now()}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)

const ids = { acOem: '', gensetOem: '', acOem2: '', gensetOem2: '', storeBoth: '', storeAcOnly: '', storeNone: '', catGenset: '', catAc: '', catPlain: '', subGenset: '', subAc: '', subPlain: '' }
const made: string[] = []
const extra = { orgB: '', oemB: '' }

const form = (subCategoryId: string, title: string) => {
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId)
  f.set('sub_category_id', subCategoryId)
  f.set('form_data', JSON.stringify({ subject: title }))
  return f
}
async function raise(sub: string, title: string) {
  actAs(fx.requesterA)
  send.mockClear()
  const r = await createRequest(form(sub, `${tag} ${title}`))
  expect(r.error, JSON.stringify(r)).toBeUndefined()
  made.push(r.requestId!)
  const t = (await admin().from('requests').select('id, status').eq('id', r.requestId!).single()).data!
  const comments = (await admin().from('request_comments').select('body, is_internal').eq('request_id', t.id)).data ?? []
  const sentTo = (addr: string) => send.mock.calls.filter((c) => ((c[0] as { to: string | string[] }).to as string[]).includes?.(addr)).length
  return { status: t.status, comments, sentTo }
}
const setStore = async (storeId: string | null) => { await admin().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id) }

beforeAll(async () => {
  send.mockResolvedValue({})
  fx = await setupD03Fixtures()
  const a = admin()
  const mkOem = async (name: string, kind: 'ac' | 'genset', email: string) => (await a.from('oems').insert({ org_id: fx.orgId, name: `${tag} ${name}`, kind, emails: [email], is_active: true } as never).select('id').single()).data!.id as string
  ids.acOem = await mkOem('AC Bluestar', 'ac', 'ac-oem@t31.test')
  ids.gensetOem = await mkOem('Genset Cummins', 'genset', 'genset-oem@t31.test')
  ids.acOem2 = await mkOem('AC Voltas', 'ac', 'ac-oem2@t31.test')
  ids.gensetOem2 = await mkOem('Genset Kirloskar', 'genset', 'genset-oem2@t31.test')
  const mkStore = async (code: string, oem: string | null, genset: string | null) => (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}-${code}`.toUpperCase(), name: `${tag} ${code}`, oem_id: oem, genset_oem_id: genset } as never).select('id').single()).data!.id as string
  ids.storeBoth = await mkStore('both', ids.acOem, ids.gensetOem)
  ids.storeAcOnly = await mkStore('aconly', ids.acOem, null)
  ids.storeNone = await mkStore('none', null, null)
  const mkCat = async (name: string, kind: string | null) => (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${name}`, slug: `${tag}-${name}`, auto_oem_kind: kind } as never).select('id').single()).data!.id as string
  ids.catGenset = await mkCat('genset', 'genset'); ids.catAc = await mkCat('ac', 'ac'); ids.catPlain = await mkCat('plain', null)
  const mkSub = async (cat: string, name: string) => {
    const s = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${name}`, slug: `${tag}-${name}` } as never).select('id').single()).data!.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: s } as never)
    return s
  }
  ids.subGenset = await mkSub(ids.catGenset, 'sub-genset'); ids.subAc = await mkSub(ids.catAc, 'sub-ac'); ids.subPlain = await mkSub(ids.catPlain, 'sub-plain')
}, 300_000)

afterAll(async () => {
  const a = admin()
  await setStore(null)
  if (made.length) { await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  await a.from('service_sub_category_tags').delete().in('sub_category_id', [ids.subGenset, ids.subAc, ids.subPlain].filter(Boolean))
  await a.from('service_sub_categories').delete().in('id', [ids.subGenset, ids.subAc, ids.subPlain].filter(Boolean))
  await a.from('service_categories').delete().in('id', [ids.catGenset, ids.catAc, ids.catPlain].filter(Boolean))
  await a.from('stores').delete().in('id', [ids.storeBoth, ids.storeAcOnly, ids.storeNone].filter(Boolean))
  await a.from('oems').delete().in('id', [ids.acOem, ids.gensetOem, ids.acOem2, ids.gensetOem2, extra.oemB].filter(Boolean))
  if (extra.orgB) await a.rpc('owner_delete_org', { p_org_id: extra.orgB })
  await fx?.cleanup()
}, 180_000)

describe('the database keeps one OEM of each type per store', () => {
  it('an OEM of the wrong type cannot go in a slot (so a store can never get a Genset OEM as its AC OEM)', async () => {
    const a = admin()
    const asAc = await a.from('stores').update({ oem_id: ids.gensetOem } as never).eq('id', ids.storeNone)
    expect(asAc.error?.code).toBe('23514')
    const asGenset = await a.from('stores').update({ genset_oem_id: ids.acOem } as never).eq('id', ids.storeNone)
    expect(asGenset.error?.code).toBe('23514')
    const unchanged = (await a.from('stores').select('oem_id, genset_oem_id').eq('id', ids.storeNone).single()).data!
    expect(unchanged).toEqual({ oem_id: null, genset_oem_id: null })
  })
  it('a store holds one AC OEM and one Genset OEM at the same time (like ALC: Bluestar for AC, Cummins for Genset)', async () => {
    const s = (await admin().from('stores').select('oem_id, genset_oem_id').eq('id', ids.storeBoth).single()).data!
    expect(s).toEqual({ oem_id: ids.acOem, genset_oem_id: ids.gensetOem })
  })
  it('an OEM of another organisation cannot be used', async () => {
    const a = admin()
    extra.orgB = (await a.from('organizations').insert({ name: `${tag} Org B`, slug: `${tag}-b`, status: 'active', seat_limit: 5 } as never).select('id').single()).data!.id
    extra.oemB = (await a.from('oems').insert({ org_id: extra.orgB, name: `${tag} other org`, kind: 'ac', emails: [] } as never).select('id').single()).data!.id
    const r = await a.from('stores').update({ oem_id: extra.oemB } as never).eq('id', ids.storeNone)
    expect(r.error?.code).toBe('23514')
  })
  it('an OEM that is mapped to stores cannot change its type; an unmapped one can', async () => {
    const a = admin()
    const mapped = await a.from('oems').update({ kind: 'genset' } as never).eq('id', ids.acOem)
    expect(mapped.error?.code).toBe('23514')
    const free = await a.from('oems').update({ kind: 'genset' } as never).eq('id', ids.acOem2)
    expect(free.error).toBeNull()
    await a.from('oems').update({ kind: 'ac' } as never).eq('id', ids.acOem2)
  })
  it('the type is limited to ac or genset', async () => {
    const r = await admin().from('oems').insert({ org_id: fx.orgId, name: `${tag} bad`, kind: 'ups', emails: [] } as never)
    expect(r.error).not.toBeNull()
  })
})

describe('the admin actions set only the slot of the OEM\'s own type', () => {
  it('creates an OEM with a type, refuses an unknown type', async () => {
    actAs(fx.admin)
    const ok = await createOem({ name: `${tag} created genset`, kind: 'genset', emails: ['x@t31.test'] })
    expect(ok.error).toBeUndefined()
    const row = (await admin().from('oems').select('kind').eq('id', ok.data!.id).single()).data!
    expect(row.kind).toBe('genset')
    await admin().from('oems').delete().eq('id', ok.data!.id)
    const bad = await createOem({ name: `${tag} bad`, kind: 'ups' as never, emails: [] })
    expect(bad.error).toMatch(/AC or Genset/)
  })
  it('assigning stores to a Genset OEM changes only the Genset slot and tells which OEM was replaced', async () => {
    actAs(fx.admin)
    // storeBoth already has Cummins; moving it to Kirloskar replaces Cummins, its AC OEM stays
    const r = await setOemStores(ids.gensetOem2, [ids.storeBoth, ids.storeAcOnly])
    expect(r.error).toBeUndefined()
    expect(r.data!.assigned).toBe(2)
    expect(r.data!.moved).toBe(1)
    expect(r.data!.movedFrom).toEqual([{ store: expect.stringContaining('BOTH'), from: `${tag} Genset Cummins` }])
    const both = (await admin().from('stores').select('oem_id, genset_oem_id').eq('id', ids.storeBoth).single()).data!
    expect(both).toEqual({ oem_id: ids.acOem, genset_oem_id: ids.gensetOem2 })
    const acOnly = (await admin().from('stores').select('oem_id, genset_oem_id').eq('id', ids.storeAcOnly).single()).data!
    expect(acOnly).toEqual({ oem_id: ids.acOem, genset_oem_id: ids.gensetOem2 })
    // put it back
    await setOemStores(ids.gensetOem, [ids.storeBoth])
    await setOemStores(ids.gensetOem2, [])
    const back = (await admin().from('stores').select('genset_oem_id').eq('id', ids.storeBoth).single()).data!
    expect(back.genset_oem_id).toBe(ids.gensetOem)
  })
  it('assigning stores to an AC OEM changes only the AC slot', async () => {
    actAs(fx.admin)
    const r = await setOemStores(ids.acOem2, [ids.storeNone])
    expect(r.error).toBeUndefined()
    const s = (await admin().from('stores').select('oem_id, genset_oem_id').eq('id', ids.storeNone).single()).data!
    expect(s).toEqual({ oem_id: ids.acOem2, genset_oem_id: null })
    await setOemStores(ids.acOem2, [])
  })
  it('an OEM that has stores cannot be changed to the other type (a clear message, nothing changes)', async () => {
    actAs(fx.admin)
    const r = await updateOem(ids.gensetOem, { kind: 'ac' })
    expect(r.error).toMatch(/Remove this OEM from its stores/)
    expect((await admin().from('oems').select('kind').eq('id', ids.gensetOem).single()).data!.kind).toBe('genset')
  })
})

describe('tickets go to the store\'s OEM of the category\'s type', () => {
  it('a Genset category goes to the store\'s Genset OEM only, and the ticket moves to In Progress', async () => {
    await setStore(ids.storeBoth)
    const t = await raise(ids.subGenset, 'genset both')
    expect(t.sentTo('genset-oem@t31.test')).toBe(1)
    expect(t.sentTo('ac-oem@t31.test')).toBe(0)
    expect(t.status).toBe('in_progress')
    expect(t.comments.some((c) => /Ticket sent to .*Genset Cummins/.test(c.body) && !c.is_internal)).toBe(true)
  })
  it('an AC category goes to the store\'s AC OEM only', async () => {
    await setStore(ids.storeBoth)
    const t = await raise(ids.subAc, 'ac both')
    expect(t.sentTo('ac-oem@t31.test')).toBe(1)
    expect(t.sentTo('genset-oem@t31.test')).toBe(0)
    expect(t.status).toBe('in_progress')
  })
  it('a normal category is not sent to anybody', async () => {
    await setStore(ids.storeBoth)
    const t = await raise(ids.subPlain, 'plain both')
    expect(t.sentTo('ac-oem@t31.test') + t.sentTo('genset-oem@t31.test')).toBe(0)
    expect(t.status).toBe('open')
  })
  it('a store with no Genset OEM: the ticket stays open, nothing is sent (not even to its AC OEM), and an internal note says why', async () => {
    await setStore(ids.storeAcOnly)
    // storeAcOnly had its Genset OEM cleared above
    await admin().from('stores').update({ genset_oem_id: null } as never).eq('id', ids.storeAcOnly)
    const t = await raise(ids.subGenset, 'genset acOnly')
    expect(t.sentTo('ac-oem@t31.test') + t.sentTo('genset-oem@t31.test')).toBe(0)
    expect(t.status).toBe('open')
    expect(t.comments.some((c) => c.is_internal && /No Genset OEM is mapped to this store/.test(c.body))).toBe(true)
  })
  it('a requester without a store: open, nothing sent, internal note', async () => {
    await setStore(null)
    const t = await raise(ids.subGenset, 'genset nostore')
    expect(t.sentTo('genset-oem@t31.test')).toBe(0)
    expect(t.status).toBe('open')
    expect(t.comments.some((c) => c.is_internal && /not linked to a store/.test(c.body))).toBe(true)
  })
  it('an inactive OEM or one with no e-mail address is skipped, the ticket stays open (as for AC today)', async () => {
    await setStore(ids.storeBoth)
    await admin().from('oems').update({ is_active: false }).eq('id', ids.gensetOem)
    const t = await raise(ids.subGenset, 'genset inactive')
    await admin().from('oems').update({ is_active: true }).eq('id', ids.gensetOem)
    expect(t.sentTo('genset-oem@t31.test')).toBe(0)
    expect(t.status).toBe('open')
  })
})
