/**
 * Bulk password reset — the safety rules, against the real auth server and database:
 *  - admin / platform owner only can run it
 *  - never touches platform owners or the caller; an administrator cannot touch another administrator (D-009),
 *    while a platform owner can
 *  - reset users can sign in with the temporary password and are flagged to change it
 *  - by default each account gets its OWN password (A-05); one shared password only when the administrator
 *    deliberately types one, and it must still pass the password policy
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
    const { ids, error, admins } = await listPasswordResetTargets()
    expect(error).toBeUndefined()
    expect(ids).toContain(fx.requesterA.id)
    expect(ids).toContain(fx.agentA.id)
    expect(ids).toContain(fx.manager.id)
    expect(ids).not.toContain(fx.admin.id)
    expect(ids).not.toContain(fx.platformOwner.id)
    expect(admins).toBe(0)
  })

  it('a platform owner also targets administrators, but never another platform owner or themselves', async () => {
    actAs(fx.platformOwner)
    const po = await listPasswordResetTargets()
    expect(po.ids).not.toContain(fx.platformOwner.id)
    expect(po.ids).toContain(fx.admin.id)
    expect(po.ids).toContain(fx.requesterA.id)
    expect(po.admins).toBeGreaterThanOrEqual(1)
  })

  it('validates the batch size, and a shared password must pass the password policy', async () => {
    actAs(fx.admin)
    expect((await resetPasswordsBatch([])).error).toMatch(/no users/i)
    const many = Array.from({ length: 41 }, () => fx.requesterA.id)
    expect((await resetPasswordsBatch(many)).error).toMatch(/at most/i)
    // too short, and too simple — refused before a single account is touched
    expect((await resetPasswordsBatch([fx.requesterA.id], 'Short1!')).error).toMatch(/at least 10 characters/i)
    expect((await resetPasswordsBatch([fx.requesterA.id], 'aaaaaaaaaaaa')).error).toMatch(/too simple/i)
    expect(await canSignIn(fx.requesterA.email, 'aaaaaaaaaaaa')).toBe(false)
  })

  it('refuses admins, platform owners and the caller even if their ids are sent directly', async () => {
    actAs(fx.admin)
    const r = await resetPasswordsBatch([fx.platformOwner.id, fx.admin.id], TEMP)
    expect(r.succeeded).toBe(0)
    expect(r.failed).toHaveLength(2)
    expect(await canSignIn(fx.platformOwner.email, TEMP)).toBe(false)
    expect(await canSignIn(fx.admin.email, TEMP)).toBe(false)
  })

  it('resets eligible users: each gets its OWN temporary password, they can sign in with it and must change it (A-05)', async () => {
    actAs(fx.admin)
    const r = await resetPasswordsBatch([fx.requesterA.id, fx.agentA.id])
    expect(r.error).toBeUndefined()
    expect(r.succeeded).toBe(2)
    expect(r.failed).toEqual([])

    const cred = (email: string) => r.credentials?.find((c) => c.email === email.toLowerCase())?.password
    expect(cred(fx.requesterA.email)).toBeTruthy()
    expect(cred(fx.agentA.email)).toBeTruthy()
    expect(cred(fx.requesterA.email)).not.toBe(cred(fx.agentA.email))   // never one shared password
    expect(await canSignIn(fx.requesterA.email, cred(fx.requesterA.email)!)).toBe(true)
    expect(await canSignIn(fx.agentA.email, cred(fx.agentA.email)!)).toBe(true)
    expect(await canSignIn(fx.agentA.email, cred(fx.requesterA.email)!)).toBe(false)

    const { data } = await admin.from('profiles').select('id, must_reset_password').in('id', [fx.requesterA.id, fx.agentA.id])
    expect((data ?? []).every((p) => p.must_reset_password === true)).toBe(true)
  })

  it('with a shared password: everybody gets the one the administrator typed, and none is handed back', async () => {
    actAs(fx.admin)
    const r = await resetPasswordsBatch([fx.manager.id], TEMP)
    expect(r.error).toBeUndefined()
    expect(r.succeeded).toBe(1)
    expect(r.failed).toEqual([])
    // nothing to hand over — the administrator typed it, so it is never returned or stored
    expect(r.credentials).toEqual([])
    expect(await canSignIn(fx.manager.email, TEMP)).toBe(true)

    const { data } = await admin.from('profiles').select('must_reset_password').eq('id', fx.manager.id).single()
    expect(data?.must_reset_password).toBe(true)
  })

  it('leaves everyone it did not touch alone', async () => {
    const { data } = await admin.from('profiles').select('id, must_reset_password').in('id', [fx.admin.id, fx.platformOwner.id, fx.requesterB.id])
    expect((data ?? []).every((p) => p.must_reset_password !== true)).toBe(true)
    expect(await canSignIn(fx.requesterB.email, TEMP)).toBe(false)
  })
})
