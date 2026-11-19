import { describe, it, expect, vi, beforeEach } from 'vitest'

// The page that sets a new password cannot be used by just anybody: without the e-mailed one-time link (or an administrator's reset flag) nothing is changed.
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))
const updateUser = vi.fn(async () => ({ error: null }))
const signOut = vi.fn(async () => ({}))
let accessToken: string | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'sm.abc@citykartstores.com' } } }),
      getSession: async () => ({ data: { session: accessToken ? { access_token: accessToken } : null } }),
      updateUser: (...a: unknown[]) => (updateUser as (...x: unknown[]) => unknown)(...a),
      signOut: (...a: unknown[]) => (signOut as (...x: unknown[]) => unknown)(...a),
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ update: () => ({ eq: async () => ({}) }) }) }) }))
let flagged: { id: string; must_reset_password: boolean } | null = null
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => null, getCurrentProfileForPasswordReset: async () => flagged }))
const notice = vi.fn(async () => ({}))
vi.mock('@/lib/email/auth-mail', () => ({ emailPasswordResetLink: async () => ({}), emailPasswordChangedNotice: (...a: unknown[]) => (notice as (...x: unknown[]) => unknown)(...a) }))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: vi.fn(async () => {}) }))

// a token whose sign-in method list says "recovery" just now
const tokenFor = (method: string, whenSec: number) => `h.${Buffer.from(JSON.stringify({ amr: [{ method, timestamp: whenSec }] })).toString('base64url')}.s`

const form = (password: string) => { const fd = new FormData(); fd.set('password', password); return fd }
const GOOD = 'Correct-Horse#2026'

beforeEach(() => { updateUser.mockClear(); signOut.mockClear(); notice.mockClear(); accessToken = null; flagged = null })

describe('setting a new password', () => {
  it('a plain visit with no e-mailed link and no administrator flag changes nothing', async () => {
    const { resetPassword } = await import('@/lib/actions/auth')
    const r = await resetPassword(form(GOOD))
    expect(r?.error).toMatch(/Change password/)
    expect(updateUser).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
  })

  it('an old link session (older than an hour) is not enough', async () => {
    accessToken = tokenFor('recovery', Math.floor(Date.now() / 1000) - 2 * 3600)
    const { resetPassword } = await import('@/lib/actions/auth')
    expect((await resetPassword(form(GOOD)))?.error).toMatch(/Change password/)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('a session started from the e-mailed link just now sets the password, ends other sessions and tells the owner by e-mail', async () => {
    accessToken = tokenFor('recovery', Math.floor(Date.now() / 1000) - 60)
    const { resetPassword } = await import('@/lib/actions/auth')
    await expect(resetPassword(form(GOOD))).rejects.toThrow('REDIRECT:/home')
    expect(updateUser).toHaveBeenCalledWith({ password: GOOD })
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' })
    expect(notice).toHaveBeenCalledWith('sm.abc@citykartstores.com', 'reset-link')
  })

  it('a weak password is refused before anything else', async () => {
    accessToken = tokenFor('recovery', Math.floor(Date.now() / 1000) - 60)
    const { resetPassword } = await import('@/lib/actions/auth')
    expect((await resetPassword(form('abc')))?.error).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
  })
})
