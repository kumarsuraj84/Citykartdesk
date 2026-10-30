// Sign-in without a trusted client address (A-04 / G-09): a wrong-password streak is answered by a short, growing wait that ends by itself (not a 10-minute lock that
// any stranger could keep switching on), the answer never says whether the account exists, and what a person typed is not copied into the audit trail (A-16).
// Also: the new-password rule on the reset-link and own-change actions (A-09).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const audits: { action: string; after?: { email?: string } }[] = []
let nextSignIn: 'ok' | 'fail' = 'fail'
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => (nextSignIn === 'ok' ? { data: { user: { id: 'u1' } }, error: null } : { data: null, error: { message: 'Invalid login credentials' } }),
      signOut: async () => ({}),
      getUser: async () => ({ data: { user: { id: 'u1', email: 'me@citykart.org' } } }),
      getSession: async () => ({ data: { session: null } }),
      updateUser: async () => ({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_active: true } }) }) }) }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => null, getCurrentProfileForPasswordReset: async () => ({ id: 'u1', must_reset_password: true }) }))
vi.mock('@/lib/email/auth-mail', () => ({ emailPasswordResetLink: async () => ({}) }))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: vi.fn(async (e: { action: string; after?: { email?: string } }) => { audits.push(e) }) }))

const saved = process.env.TRUSTED_PROXY_HOPS
beforeEach(() => { delete process.env.TRUSTED_PROXY_HOPS; nextSignIn = 'fail'; audits.length = 0; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-29T10:00:00Z')) })
afterEach(() => { vi.useRealTimers(); if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = saved })

const form = (email: string, password = 'x') => { const fd = new FormData(); fd.set('email', email); fd.set('password', password); return fd }
async function tryLogin(email: string, password?: string): Promise<string> {
  const { signInWithPassword } = await import('@/lib/actions/auth')
  try { return ((await signInWithPassword(form(email, password))) as { error?: string }).error ?? 'no error' } catch (e) { return String((e as Error).message) }
}
const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))

describe('sign-in with no trusted address', () => {
  it('after ten wrong tries the account waits, the wait grows, and it ends by itself', async () => {
    const email = `prog-${Date.now()}-a@citykart.org`
    for (let i = 0; i < 10; i++) expect(await tryLogin(email)).toMatch(/credentials/i)
    expect(await tryLogin(email)).toMatch(/Too many/)                  // 10th failure started a 30 s wait
    tick(31_000)
    expect(await tryLogin(email)).toMatch(/credentials/i)              // free again after the wait (not a 10-minute lock)
    expect(await tryLogin(email)).toMatch(/Too many/)                  // and the next wait is longer
    tick(31_000)
    expect(await tryLogin(email)).toMatch(/Too many/)                  // 60 s: still waiting after 31 s
    tick(30_000)
    expect(await tryLogin(email)).toMatch(/credentials/i)
  })
  it('the answer is the same whether or not the account exists (the key is just what was typed)', async () => {
    const a = `prog-${Date.now()}-known@citykart.org`, b = `prog-${Date.now()}-unknown@citykart.org`
    for (let i = 0; i < 10; i++) { await tryLogin(a); await tryLogin(b) }
    expect(await tryLogin(a)).toBe(await tryLogin(b))
  })
  it('a correct sign-in clears the count; another account is never affected', async () => {
    const email = `prog-${Date.now()}-c@citykart.org`
    for (let i = 0; i < 6; i++) await tryLogin(email)
    nextSignIn = 'ok'
    expect(await tryLogin(email)).toMatch(/REDIRECT/)
    nextSignIn = 'fail'
    for (let i = 0; i < 9; i++) expect(await tryLogin(email)).toMatch(/credentials/i)   // nine more are free again
    expect(await tryLogin(`prog-${Date.now()}-other@citykart.org`)).toMatch(/credentials/i)
  })
})

describe('what is written to the audit trail about an attempt (A-16)', () => {
  it('an e-mail address is kept; a password typed in the e-mail box is only a fingerprint', async () => {
    await tryLogin('real.person@citykart.org')
    await tryLogin('Welcome@citykart@123')
    const failed = audits.filter((a) => a.action === 'auth.login_failed')
    expect(failed[0].after?.email).toBe('real.person@citykart.org')
    expect(failed[1].after?.email).not.toContain('Welcome')
    expect(failed[1].after?.email).toMatch(/fingerprint/)
  })
})

describe('new passwords on the reset-link and own-change actions (A-09)', () => {
  it('resetPassword refuses a weak password and says what is needed', async () => {
    const { resetPassword } = await import('@/lib/actions/auth')
    const fd = new FormData(); fd.set('password', 'abcdefgh')
    expect(((await resetPassword(fd)) as { error?: string }).error).toMatch(/at least 10/)
  })
  it('changeOwnPassword refuses a weak new password before asking the service anything', async () => {
    const { changeOwnPassword } = await import('@/lib/actions/auth')
    const fd = new FormData(); fd.set('currentPassword', 'whatever'); fd.set('newPassword', 'lowercaseonlylong')
    expect((await changeOwnPassword(fd)).error).toMatch(/too simple/)
    fd.set('newPassword', 'Short1!')
    expect((await changeOwnPassword(fd)).error).toMatch(/at least 10/)
  })
})
