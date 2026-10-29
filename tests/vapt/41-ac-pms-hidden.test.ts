// The AC PMS service is for the daily job only (isolated audit stack, synthetic data):
//  - a requester, a technician and a manager are not offered it in the catalogue, in the search or by its web address; only an administrator sees it;
//  - only an administrator can raise an AC PMS ticket by hand (web form); everybody else is refused, and so is every other channel (mail, WhatsApp);
//  - the daily job (system generated) can still make the ticket.
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
import { getServices, searchServices, getServiceBySlug, getAllServicesForAdmin } from '@/lib/queries/services'
import { createRequestCore } from '@/lib/requests/create-request-core'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t41${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const ids = { cat: '', sub: '', service: '', slug: '' }
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const made: string[] = []

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} AC-PMS`, slug: `${tag}-pms`, is_pms: true }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} AC-PMS`, slug: `${tag}-pms-sub` }).select('id').single()).data.id
  ids.slug = `${tag}-pms-service`
  ids.service = (await a.from('services').insert({ org_id: fx.orgId, name: `${tag} AC-PMS`, slug: ids.slug, team_id: fx.teamA.id, is_active: true, status: 'published', form_fields: [], form_sections: [] }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: ids.service, sub_category_id: ids.sub })
}, 240_000)

afterAll(async () => {
  const a = db()
  if (made.length) { await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  await a.from('service_sub_category_tags').delete().eq('service_id', ids.service)
  await a.from('services').delete().eq('id', ids.service)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await fx?.cleanup()
}, 180_000)

describe('the AC PMS service is hidden from everybody', () => {
  for (const [who, pick] of [['a requester', () => fx.requesterA], ['a technician', () => fx.agentA], ['a manager', () => fx.manager]] as const) {
    it(`${who} is not offered it in the catalogue, the search or by its web address`, async () => {
      actAs(pick())
      expect((await getServices()).map((s) => s.id)).not.toContain(ids.service)
      expect((await searchServices(tag)).map((s) => s.id)).not.toContain(ids.service)
      expect(await getServiceBySlug(ids.slug)).toBeNull()
    })
    it(`${who} cannot raise an AC PMS ticket by hand`, async () => {
      actAs(pick())
      const f = new FormData(); f.set('service_id', ids.service); f.set('sub_category_id', ids.sub); f.set('form_data', JSON.stringify({}))
      const r = await createRequest(f)
      if (r.requestId) made.push(r.requestId)
      expect(r.requestId).toBeUndefined()
      expect(r.error).toMatch(/made automatically|cannot be raised by hand|Service not found/i)
    })
  }

  it('an administrator sees it in the catalogue, the search and by its web address, and can raise one by hand', async () => {
    actAs(fx.admin)
    expect((await getServices()).map((s) => s.id)).toContain(ids.service)
    expect((await searchServices(tag)).map((s) => s.id)).toContain(ids.service)
    expect((await getServiceBySlug(ids.slug))?.id).toBe(ids.service)
    const f = new FormData(); f.set('service_id', ids.service); f.set('sub_category_id', ids.sub); f.set('form_data', JSON.stringify({}))
    const r = await createRequest(f)
    if (r.requestId) made.push(r.requestId)
    expect(r.error).toBeUndefined()
    expect(r.requestId).toBeTruthy()
  })

  it('other services stay in the catalogue', async () => {
    actAs(fx.requesterB)
    expect((await getServices()).map((s) => s.id)).toContain(fx.teamB.serviceId)
  })

  it('the daily job (system generated) can still make the ticket', async () => {
    const r = await createRequestCore({ client: db(), orgId: fx.orgId, requesterId: fx.requesterA.id, actingUserId: fx.requesterA.id, serviceId: ids.service, subCategoryId: ids.sub, formData: {}, description: `${tag} job ticket`, source: 'api', useAdminForWrites: true, titleOverride: `${tag} AC PMS job`, systemGenerated: true })
    expect(r.error).toBeUndefined()
    expect(r.requestId).toBeTruthy()
    if (r.requestId) made.push(r.requestId)
  })

  it('the same ticket without the system flag is refused (mail, WhatsApp and web all go through this door)', async () => {
    const r = await createRequestCore({ client: db(), orgId: fx.orgId, requesterId: fx.requesterA.id, actingUserId: fx.requesterA.id, serviceId: ids.service, subCategoryId: ids.sub, formData: {}, description: `${tag} by hand`, source: 'api', useAdminForWrites: true })
    expect(r.requestId).toBeUndefined()
    expect(r.error).toMatch(/made automatically/i)
  })
})
