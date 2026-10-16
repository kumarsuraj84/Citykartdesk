// Remediation phase 2: onboarding without a shared password, and a server-side (not page-only) "must change password" (VAPT-003 / VAPT-005, earlier D-011).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string; text?: string }[] = []
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (p: { to: string; subject: string; html: string; text?: string }) => { sent.push(p); return {} }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/email/auth-mail', () => ({
  emailPasswordResetLink: vi.fn(async (to: string) => { sent.push({ to, subject: 'Reset your Citykart Desk password', html: '' }); return {} }),
  emailInvitation: vi.fn(async () => ({})), isEmailConfigured: vi.fn(async () => true),
}))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))

import { createClient } from '@/lib/supabase/server'
import { bulkCreateUsers } from '@/lib/actions/admin/users'
import { resetPassword } from '@/lib/actions/auth'
import { addComment } from '@/lib/actions/requests'
import { getCurrentProfile, getCurrentProfileForPasswordReset } from '@/lib/queries/profiles'

vi.setConfig({ testTimeout: 120_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const tag = Date.now()
const API = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const created: string[] = []

const anonClient = () => createSupabaseClient(API, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
async function signIn(email: string, password: string) {
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password })
  return { token: data.session?.access_token, error }
}
/** a database client for a signed-in person, plus the one auth call the password-change action makes (updateUser) done against the real login service */
function sessionFor(token: string) {
  const db = clientForToken(token)
  // only updateUser is replaced (the header-only test client has no stored session); everything else is the real client
  const auth = new Proxy(db.auth, {
    get(target, prop, receiver) {
      if (prop === 'updateUser') {
        return async ({ password }: { password: string }) => {
          const r = await fetch(`${API}/auth/v1/user`, { method: 'PUT', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
          return { error: r.ok ? null : { message: await r.text() } }
        }
      }
      if (prop === 'signOut') return async () => ({ error: null })
      return Reflect.get(target, prop, receiver)
    },
  })
  return new Proxy(db, { get: (target, prop, receiver) => (prop === 'auth' ? auth : Reflect.get(target, prop, target)) })
}

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => {
  for (const id of created) { try { await admin().auth.admin.deleteUser(id) } catch { /* best effort */ } }
  await fx?.cleanup()
}, 120_000)

describe('bulk import without a password column', () => {
  const emails = [`vapt-new-a-${tag}@example.test`, `vapt-new-b-${tag}@example.test`]
  let credentials: { email: string; password: string }[] = []

  it('gives every new account its own random one-time password and flags it "must change password"; the old shared default does not work', async () => {
    vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
    const res = await bulkCreateUsers(emails.map((email, i) => ({ email, full_name: `Vapt New ${i}`, role: 'user' })))
    expect(res.error).toBeUndefined()
    expect(res.data?.imported).toBe(2)
    credentials = res.data?.credentials ?? []
    expect(credentials).toHaveLength(2)
    expect(new Set(credentials.map((c) => c.password)).size).toBe(2)
    for (const c of credentials) expect(c.password.length).toBeGreaterThanOrEqual(14)
    for (const email of emails) {
      const { data } = await admin().from('profiles').select('id, must_reset_password').eq('id', (await admin().auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)!.id).single()
      created.push(data!.id)
      expect(data?.must_reset_password).toBe(true)
      expect((await signIn(email, 'Welcome@123')).error).not.toBeNull()
    }
    expect((await signIn(credentials[0].email, credentials[0].password)).error).toBeNull()
  })

  it('a person who has not chosen their own password yet can do nothing through the data API or the server actions', async () => {
    const { token } = await signIn(credentials[0].email, credentials[0].password)
    const db = clientForToken(token!)
    expect(((await db.from('requests').select('id').limit(5)).data ?? []).length).toBe(0)
    expect(((await db.from('profiles').select('id').limit(5)).data ?? []).length).toBeLessThanOrEqual(1)      // at most their own row
    vi.mocked(createClient).mockResolvedValue(sessionFor(token!) as never)
    expect(await getCurrentProfile()).toBeNull()                                  // every action sees "not signed in"
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    expect((await addComment(t.id, 'hello', false)).error).toBeTruthy()
    expect((await getCurrentProfileForPasswordReset())?.id).toBeTruthy()          // only the password-change flow can see who they are
  })

  it('after choosing their own password through the application the flag is cleared (by the server) and everything works', async () => {
    const { token } = await signIn(credentials[0].email, credentials[0].password)
    vi.mocked(createClient).mockResolvedValue(sessionFor(token!) as never)
    const fd = new FormData(); fd.set('password', `Chosen-${tag}-Pw!`)
    await expect(resetPassword(fd)).rejects.toThrow(/REDIRECT:\/home/)
    const { data } = await admin().from('profiles').select('must_reset_password').eq('id', created[0]).single()
    expect(data?.must_reset_password).toBe(false)
    const again = await signIn(credentials[0].email, `Chosen-${tag}-Pw!`)
    expect(again.error).toBeNull()
    expect(((await clientForToken(again.token!).from('profiles').select('id').limit(1)).data ?? []).length).toBe(1)
  })

  it('a flagged person cannot clear the flag themselves through the data API', async () => {
    const { token } = await signIn(credentials[1].email, credentials[1].password)
    await clientForToken(token!).from('profiles').update({ must_reset_password: false }).eq('id', created[1])
    expect((await admin().from('profiles').select('must_reset_password').eq('id', created[1]).single()).data?.must_reset_password).toBe(true)
  })
})

describe('invitation mode', () => {
  it('sends a set-your-password e-mail and hands out no password', async () => {
    sent.length = 0
    vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
    const email = `vapt-invite-${tag}@example.test`
    const res = await bulkCreateUsers([{ email, full_name: 'Vapt Invite', role: 'user' }], { onboarding: 'invite' })
    expect(res.error).toBeUndefined()
    expect(res.data?.credentials).toBeUndefined()
    expect(res.data?.invited).toBe(1)
    expect(sent.some((m) => m.to.toLowerCase() === email)).toBe(true)
    const u = (await admin().auth.admin.listUsers({ perPage: 1000 })).data.users.find((x) => x.email === email)
    if (u) created.push(u.id)
  })
})
