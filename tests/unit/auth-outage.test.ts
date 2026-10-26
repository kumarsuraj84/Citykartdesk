// QA-D016: when the sign-in service itself is down (stopped, unreachable, answering 5xx) the person used to be told "Invalid login credentials" after about 30 seconds,
// so they changed their password or reset it for nothing, and every outage try also counted toward the ten-wrong-tries limit. A wrong password is still a wrong password.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let nextError: { message: string; name?: string; status?: number; code?: string } = { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' }
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithPassword: async () => ({ data: null, error: nextError }), signOut: async () => ({}) }, from: () => ({}) }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => null, getCurrentProfileForPasswordReset: async () => null }))
vi.mock('@/lib/email/auth-mail', () => ({ emailPasswordResetLink: async () => ({}) }))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: vi.fn(async () => {}) }))

const form = (email: string) => { const fd = new FormData(); fd.set('email', email); fd.set('password', 'x'); return fd }
async function tryLogin(email: string): Promise<string> {
  const { signInWithPassword } = await import('@/lib/actions/auth')
  try { return ((await signInWithPassword(form(email))) as { error?: string }).error ?? 'no error' } catch (e) { return String((e as Error).message) }
}
beforeEach(() => { nextError = { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } })

describe('sign-in when the sign-in service is down', () => {
  it('a wrong password still says so', async () => {
    expect(await tryLogin(`wrong-${Date.now()}@citykart.org`)).toMatch(/credentials/i)
  })
  it('an unreachable service says it is unavailable, not "invalid credentials"', async () => {
    nextError = { message: 'fetch failed', name: 'AuthRetryableFetchError', status: 0 }
    expect(await tryLogin(`down-${Date.now()}@citykart.org`)).toMatch(/temporarily unavailable/i)
  })
  it('a 5xx answer says it is unavailable too', async () => {
    nextError = { message: 'Bad gateway', status: 502 }
    expect(await tryLogin(`gw-${Date.now()}@citykart.org`)).toMatch(/temporarily unavailable/i)
  })
  it('outage tries do not use up the ten wrong-password tries', async () => {
    const email = `budget-${Date.now()}@citykart.org`
    nextError = { message: 'fetch failed', name: 'AuthRetryableFetchError', status: 0 }
    for (let i = 0; i < 15; i++) expect(await tryLogin(email)).toMatch(/temporarily unavailable/i)
    nextError = { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' }
    expect(await tryLogin(email)).toMatch(/credentials/i)          // not "Too many login attempts"
  })
})
