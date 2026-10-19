// The category-limited Qty field, on the isolated audit stack: a field limited to categories (Qty for fixtures) is mandatory for those categories, ignored and not stored for others.
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

vi.setConfig({ testTimeout: 180_000 })
const admin = () => getAdmin()
const tag = `t32-${Date.now()}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const ids = { s1: '', s2: '', s3: '', catFixture: '', catPlain: '', subFixture: '', subPlain: '' }
const made: string[] = []
let originalSections: unknown = null

const form = (sub: string, data: Record<string, unknown>) => {
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub); f.set('form_data', JSON.stringify(data))
  return f
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = admin()
  const mkStore = async (code: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}-${code}`.toUpperCase(), name: `${tag} ${code}` } as never).select('id').single()).data!.id as string
  ids.s1 = await mkStore('s1'); ids.s2 = await mkStore('s2'); ids.s3 = await mkStore('s3')
  const mkCat = async (name: string) => (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${name}`, slug: `${tag}-${name}` } as never).select('id').single()).data!.id as string
  ids.catFixture = await mkCat('fixture'); ids.catPlain = await mkCat('plain')
  const mkSub = async (cat: string, name: string) => {
    const s = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${name}`, slug: `${tag}-${name}` } as never).select('id').single()).data!.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: s } as never)
    return s
  }
  ids.subFixture = await mkSub(ids.catFixture, 'sub-fixture'); ids.subPlain = await mkSub(ids.catPlain, 'sub-plain')
  // the test service gets a Subject and a Qty that exists only for the Fixture category (restored afterwards)
  originalSections = (await a.from('services').select('form_sections').eq('id', fx.teamA.serviceId).single()).data!.form_sections
  await a.from('services').update({ form_sections: [{ id: 'sec1', title: 'Details', order: 0, fields: [
    { id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 },
    { id: 'qty', type: 'number', label: 'Qty', required: true, order: 1, show_for_categories: [ids.catFixture] },
  ] }] } as never).eq('id', fx.teamA.serviceId)
}, 300_000)

afterAll(async () => {
  const a = admin()
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  if (made.length) { await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  await a.from('services').update({ form_sections: originalSections } as never).eq('id', fx.teamA.serviceId)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', [ids.subFixture, ids.subPlain].filter(Boolean))
  await a.from('service_sub_categories').delete().in('id', [ids.subFixture, ids.subPlain].filter(Boolean))
  await a.from('service_categories').delete().in('id', [ids.catFixture, ids.catPlain].filter(Boolean))
  await a.from('stores').delete().in('id', [ids.s1, ids.s2, ids.s3].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('Qty exists only for the Fixture category', () => {
  it('a Fixture ticket without Qty is refused ("Qty is required"), with Qty it is created and Qty is stored', async () => {
    actAs(fx.requesterA)
    const missing = await createRequest(form(ids.subFixture, { subject: `${tag} fixture no qty` }))
    expect(missing.requestId).toBeUndefined()
    expect(missing.error).toMatch(/Qty is required/)
    const ok = await createRequest(form(ids.subFixture, { subject: `${tag} fixture with qty`, qty: 25 }))
    expect(ok.error, JSON.stringify(ok)).toBeUndefined()
    made.push(ok.requestId!)
    const row = (await admin().from('requests').select('form_data').eq('id', ok.requestId!).single()).data!
    expect((row.form_data as Record<string, unknown>).qty).toBe(25)
  })
  it('another category does not ask for Qty, and a Qty sent anyway is not stored', async () => {
    actAs(fx.requesterA)
    const ok = await createRequest(form(ids.subPlain, { subject: `${tag} paint`, qty: 99 }))
    expect(ok.error, JSON.stringify(ok)).toBeUndefined()
    made.push(ok.requestId!)
    const row = (await admin().from('requests').select('form_data').eq('id', ok.requestId!).single()).data!
    expect((row.form_data as Record<string, unknown>).qty).toBeUndefined()
    const noQty = await createRequest(form(ids.subPlain, { subject: `${tag} paint without qty` }))
    expect(noQty.error, JSON.stringify(noQty)).toBeUndefined()
    made.push(noQty.requestId!)
  })
})
