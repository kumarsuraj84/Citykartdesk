/**
 * D-12 — createOem()/updateOem() called revalidatePath('/admin/oems'), a
 * route that doesn't exist (the OEM admin UI lives on the OEM tab of
 * '/admin/org', OrgStructureClient.tsx). deleteOem() already had the correct
 * path. Net effect: creating or editing an OEM left the org admin page
 * showing stale data until a hard refresh, while deleting worked correctly —
 * an inconsistency across the same three sibling actions.
 *
 * Reuses the D-03 fixture set purely for its ready-made admin identity.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createOem, updateOem, deleteOem } from '@/lib/actions/admin/oems'

const mockedCreateClient = vi.mocked(createClient)
const mockedRevalidatePath = vi.mocked(revalidatePath)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('D-12: OEM admin actions revalidate the real /admin/org route', () => {
  let fx: D03Fixtures
  const createdOemIds: string[] = []

  beforeAll(async () => {
    fx = await setupD03Fixtures()
  }, 60_000)

  afterAll(async () => {
    if (createdOemIds.length > 0) await getAdmin().from('oems').delete().in('id', createdOemIds)
    await fx.cleanup()
  }, 60_000)

  it('createOem revalidates /admin/org, not the nonexistent /admin/oems', async () => {
    actAs(fx.admin)
    mockedRevalidatePath.mockClear()
    const result = await createOem({ name: 'D-12 Test OEM', emails: ['vendor@example.test'] })
    expect(result.error).toBeUndefined()
    if (result.data?.id) createdOemIds.push(result.data.id)

    expect(mockedRevalidatePath).toHaveBeenCalledWith('/admin/org')
    expect(mockedRevalidatePath).not.toHaveBeenCalledWith('/admin/oems')
  })

  it('updateOem revalidates /admin/org, not the nonexistent /admin/oems', async () => {
    actAs(fx.admin)
    const { data: oem } = await getAdmin().from('oems').insert({ org_id: fx.orgId, name: 'D-12 Update Target', emails: [] }).select('id').single()
    if (oem?.id) createdOemIds.push(oem.id)

    mockedRevalidatePath.mockClear()
    const result = await updateOem(oem!.id, { name: 'D-12 Updated Name' })
    expect(result.error).toBeUndefined()

    expect(mockedRevalidatePath).toHaveBeenCalledWith('/admin/org')
    expect(mockedRevalidatePath).not.toHaveBeenCalledWith('/admin/oems')
  })

  it('deleteOem still revalidates /admin/org (regression — this one was already correct)', async () => {
    actAs(fx.admin)
    const { data: oem } = await getAdmin().from('oems').insert({ org_id: fx.orgId, name: 'D-12 Delete Target', emails: [] }).select('id').single()

    mockedRevalidatePath.mockClear()
    const result = await deleteOem(oem!.id)
    expect(result.error).toBeUndefined()
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/admin/org')
  })
})
