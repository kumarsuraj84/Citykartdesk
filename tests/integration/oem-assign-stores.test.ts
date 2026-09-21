/**
 * Assign stores to an OEM — against the real local database:
 *  - only admin/manager can run it
 *  - ticked stores get the OEM, unticked stores of that OEM become unmapped
 *  - a store under another OEM moves; stores under other OEMs that were not ticked are untouched
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { setOemStores } from '@/lib/actions/admin/oems'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('setOemStores', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const tag = `t${Date.now()}`
  let oemA = '', oemB = ''
  const storeIds: string[] = []

  const oemOf = async (id: string) => (await admin.from('stores').select('oem_id').eq('id', id).single()).data?.oem_id ?? null

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    const a = await admin.from('oems').insert({ org_id: fx.orgId, name: `A-${tag}`, emails: [] }).select('id').single()
    const b = await admin.from('oems').insert({ org_id: fx.orgId, name: `B-${tag}`, emails: [] }).select('id').single()
    oemA = a.data!.id; oemB = b.data!.id
    for (let i = 0; i < 4; i++) {
      const { data } = await admin.from('stores').insert({ org_id: fx.orgId, code: `${tag}-${i}`, name: `Store ${i}`, oem_id: i === 2 ? oemB : i === 3 ? oemA : null }).select('id').single()
      storeIds.push(data!.id)
    }
  }, 90_000)

  afterAll(async () => {
    await admin.from('stores').delete().in('id', storeIds)
    await admin.from('oems').delete().in('id', [oemA, oemB])
    await fx?.cleanup()
  }, 90_000)

  it('is refused for a requester', async () => {
    actAs(fx.requesterA)
    expect((await setOemStores(oemA, [storeIds[0]])).error).toBeTruthy()
    expect(await oemOf(storeIds[0])).toBeNull()
  })

  it('assigns, moves from another OEM, and unmaps unticked stores of this OEM', async () => {
    actAs(fx.admin)
    // s0 (unmapped) + s2 (currently OEM B) ticked; s3 (currently OEM A) unticked
    const res = await setOemStores(oemA, [storeIds[0], storeIds[2]])
    expect(res.error).toBeUndefined()
    expect(res.data).toEqual({ assigned: 2, removed: 1, moved: 1 })
    expect(await oemOf(storeIds[0])).toBe(oemA)
    expect(await oemOf(storeIds[2])).toBe(oemA)
    expect(await oemOf(storeIds[3])).toBeNull()
    expect(await oemOf(storeIds[1])).toBeNull()
  })

  it('does not touch stores that belong to another OEM and were not ticked', async () => {
    actAs(fx.admin)
    await admin.from('stores').update({ oem_id: oemB }).eq('id', storeIds[1])
    const res = await setOemStores(oemA, [storeIds[0], storeIds[2]])
    expect(res.data).toEqual({ assigned: 0, removed: 0, moved: 0 })
    expect(await oemOf(storeIds[1])).toBe(oemB)
  })

  it('rejects an OEM that is not in the organisation', async () => {
    actAs(fx.admin)
    expect((await setOemStores('00000000-0000-0000-0000-000000000000', [storeIds[0]])).error).toMatch(/not found/i)
  })
})
