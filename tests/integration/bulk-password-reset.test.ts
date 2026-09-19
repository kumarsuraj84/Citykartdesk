/**
 * Bulk password reset — the safety rules, against the real auth server and database:
 *  - admin / platform owner only can run it
 *  - never touches admins, platform owners or the caller
 *  - reset users can sign in with the temporary password and are flagged to change it
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { listPasswordResetTargets, resetPasswordsBatch } from '@/lib/actions/admin/users'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

const TEMP = 'Temp-Reset#2026'

async function canSignIn(email: string, password: string): Promise<boolean> {
  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await anon.auth.signInWithPassword({ email, password })
  return !!data.session
}

describe('bulk password reset', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupD03Fixtures()
  }, 90_000)

  afterAll(async () => {
    await fx?.cleanup()
  }, 90_000)

  it('is refused for anyone who is not an admin or platform owner', async () => {
    actAs(fx.agentA)
    expect((await listPasswordResetTargets()).error).toBe('Unauthorized.')
    expect((await resetPasswordsBatch([fx.requesterA.id], TEMP)).error).toBe('Unauthorized.')

    actAs(fx.manager)
    expect((await resetPasswordsBatch([fx.requesterA.id], TEMP)).error).toBe('Unauthorized.')
  })

  it('targets users, agents and managers only — never admins, platform owners or the caller', async () => {
    actAs(fx.admin)
    const { ids, error } = await listPasswordResetTargets()
    expect(error).toBeUndefined()
    expect(ids).toContain(fx.requesterA.id)
    expect(ids).toContain(fx.agentA.id)
    expect(ids).toContain(fx.manager.id)
    expect(ids).not.toContain(fx.admin.id)
    expect(ids).not.toContain(fx.platformOwner.id)

    actAs(fx.platformOwner)
    const po = await listPasswordResetTargets()
    expect(po.ids).not.toContain(fx.platformOwner.id)
    expect(po.ids).not.toContain(fx.admin.id)
  })

  it('validates the password and the batch size', async () => {
    actAs(fx.admin)
    expect((await resetPasswordsBatch([fx.requesterA.id], 'short')).error).toMatch(/at least 8/i)
    expect((await resetPasswordsBatch([], TEMP)).error).toMatch(/no users/i)
    const many = Array.from({ length: 41 }, () => fx.requesterA.id)
    expect((await resetPasswordsBatch(many, TEMP)).error).toMatch(/at most/i)
  })

  it('refuses admins, platform owners and the caller even if their ids are sent directly', async () => {
    actAs(fx.admin)
    const r = await resetPasswordsBatch([fx.platformOwner.id, fx.admin.id], TEMP)
    expect(r.succeeded).toBe(0)
    expect(r.failed).toHaveLength(2)
    expect(await canSignIn(fx.platformOwner.email, TEMP)).toBe(false)
    expect(await canSignIn(fx.admin.email, TEMP)).toBe(false)
  })

  it('resets eligible users: they can sign in with the temporary password and must change it', async () => {
    actAs(fx.admin)
    const r = await resetPasswordsBatch([fx.requesterA.id, fx.agentA.id], TEMP)
    expect(r.error).toBeUndefined()
    expect(r.succeeded).toBe(2)
    expect(r.failed).toEqual([])

    expect(await canSignIn(fx.requesterA.email, TEMP)).toBe(true)
    expect(await canSignIn(fx.agentA.email, TEMP)).toBe(true)

    const { data } = await admin.from('profiles').select('id, must_reset_password').in('id', [fx.requesterA.id, fx.agentA.id])
    expect((data ?? []).every((p) => p.must_reset_password === true)).toBe(true)
  })

  it('leaves everyone it did not touch alone', async () => {
    const { data } = await admin.from('profiles').select('id, must_reset_password').in('id', [fx.admin.id, fx.platformOwner.id, fx.requesterB.id])
    expect((data ?? []).every((p) => p.must_reset_password !== true)).toBe(true)
    expect(await canSignIn(fx.requesterB.email, TEMP)).toBe(false)
  })
})
