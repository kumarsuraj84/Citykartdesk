/**
 * An admin can change the e-mail a person signs in with. Real sign-in service: the person can sign in with the new address and
 * not the old one, with the same password; duplicates, wrong roles and other organisations are refused.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

const PASSWORD = 'Uat-Desk-003-Test-Pw!'
const caller = { current: { id: '', role: 'admin', org_id: '00000000-0000-0000-0000-000000000001' } as { id: string; role: string; org_id: string } }
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn(async () => caller.current) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { updateUserEmail } from '@/lib/actions/admin/users'

vi.setConfig({ testTimeout: 60_000 })

const signIn = async (email: string, password = PASSWORD) => {
  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  return { ok: !!data.session && !error }
}

describe('admin: change a user\'s e-mail', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const stamp = Date.now()
  const emailOf = async (id: string) => (await admin.auth.admin.getUserById(id)).data.user?.email

  beforeAll(async () => { fx = await setupD03Fixtures() }, 120_000)
  afterAll(async () => { await fx?.cleanup() }, 120_000)
  beforeEach(() => { caller.current = { id: fx.admin.id, role: 'admin', org_id: fx.orgId } })

  it('the person signs in with the new address, with the same password, and the old address stops working', async () => {
    const next = `changed-${stamp}@example.test`
    expect((await signIn(fx.requesterA.email)).ok).toBe(true)
    const res = await updateUserEmail(fx.requesterA.id, `  ${next.toUpperCase()}  `)
    expect(res).toEqual({ email: next, updated: '' }) // trimmed and lower-cased; the old address was not used anywhere else
    expect(await emailOf(fx.requesterA.id)).toBe(next)
    expect((await signIn(next)).ok).toBe(true)
    expect((await signIn(fx.requesterA.email)).ok).toBe(false)
    // the change is recorded
    const { data: audit } = await admin.from('admin_audit_log').select('action, metadata').eq('entity_id', fx.requesterA.id).eq('action', 'user_email_changed')
    expect(audit?.length).toBeGreaterThan(0)
    expect(audit![0].metadata).toMatchObject({ from: fx.requesterA.email.toLowerCase(), to: next })
    // change it back so the fixtures can sign the user in again
    await updateUserEmail(fx.requesterA.id, fx.requesterA.email)
    expect(await emailOf(fx.requesterA.id)).toBe(fx.requesterA.email)
  })

  it('refuses an address another account already uses, one that is not an address, and the same address', async () => {
    expect((await updateUserEmail(fx.requesterB.id, fx.agentA.email)).error).toBe('Another account already uses this e-mail address.')
    expect((await updateUserEmail(fx.requesterB.id, 'not-an-email')).error).toBe('This does not look like an e-mail address.')
    expect((await updateUserEmail(fx.requesterB.id, '   ')).error).toBe('Enter the new e-mail address.')
    expect((await updateUserEmail(fx.requesterB.id, fx.requesterB.email.toUpperCase())).error).toBe('This is already their e-mail address.')
    expect(await emailOf(fx.requesterB.id)).toBe(fx.requesterB.email) // nothing changed
  })

  it('only admins and platform owners can do it, and not for their own account', async () => {
    for (const role of ['agent', 'manager', 'user']) {
      caller.current = { id: fx.manager.id, role, org_id: fx.orgId }
      expect((await updateUserEmail(fx.requesterB.id, `x-${stamp}@example.test`)).error).toBe('Unauthorized.')
    }
    caller.current = { id: fx.admin.id, role: 'admin', org_id: fx.orgId }
    expect((await updateUserEmail(fx.admin.id, `me-${stamp}@example.test`)).error).toMatch(/another admin/)
    expect(await emailOf(fx.requesterB.id)).toBe(fx.requesterB.email)
  })

  it('an admin or platform owner\'s address can be changed only by a platform owner', async () => {
    const target = fx.manager // make them an admin for this check
    await admin.from('profiles').update({ role: 'admin' }).eq('id', target.id)
    try {
      expect((await updateUserEmail(target.id, `boss-${stamp}@example.test`)).error).toMatch(/Only a platform owner/)
      caller.current = { id: fx.platformOwner.id, role: 'platform_owner', org_id: fx.orgId }
      const res = await updateUserEmail(target.id, `boss-${stamp}@example.test`)
      expect(res.email).toBe(`boss-${stamp}@example.test`)
      await updateUserEmail(target.id, target.email)
    } finally {
      await admin.from('profiles').update({ role: 'manager' }).eq('id', target.id)
    }
  })

  it('a user of another organisation is "not found"', async () => {
    caller.current = { id: fx.admin.id, role: 'admin', org_id: '00000000-0000-0000-0000-0000000000ff' }
    expect((await updateUserEmail(fx.requesterB.id, `other-${stamp}@example.test`)).error).toBe('User not found.')
    expect((await updateUserEmail('00000000-0000-0000-0000-00000000dead', `ghost-${stamp}@example.test`)).error).toBe('User not found.')
  })
})
