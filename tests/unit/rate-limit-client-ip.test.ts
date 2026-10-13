// D-017: login and forgot-password limits must not be avoidable by changing request headers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let forwarded = ''
vi.mock('next/headers', () => ({ headers: async () => ({ get: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? forwarded || null : null) }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithPassword: async () => ({ data: null, error: { message: 'Invalid login credentials' } }), signOut: async () => ({}) }, from: () => ({}) }),
}))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => null }))
const mailed: string[] = []
vi.mock('@/lib/email/auth-mail', () => ({ emailPasswordResetLink: async (email: string) => { mailed.push(email); return {} } }))

import { getClientIp } from '@/lib/rate-limit'

const saved = process.env.TRUSTED_PROXY_HOPS
beforeEach(() => { delete process.env.TRUSTED_PROXY_HOPS; forwarded = ''; mailed.length = 0 })
afterEach(() => { if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = saved })

describe('getClientIp', () => {
  it('ignores client-supplied forwarding headers when no trusted proxy is configured (the original gap)', async () => {
    forwarded = '1.2.3.4, 5.6.7.8'
    expect(await getClientIp()).toBeNull()
  })
  it('with one trusted proxy it uses the entry that proxy appended, not the first (client-chosen) one', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    forwarded = '6.6.6.6, 203.0.113.9'
    expect(await getClientIp()).toBe('203.0.113.9')
  })
  it('with two trusted proxies it takes the second from the right', async () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    forwarded = 'spoofed, 198.51.100.7, 10.0.0.2'
    expect(await getClientIp()).toBe('198.51.100.7')
  })
  it('a header with fewer entries than trusted proxies is not believed', async () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    forwarded = '203.0.113.9'
    expect(await getClientIp()).toBeNull()
  })
})

describe('login limit follows the account, not a header', () => {
  it('rotating X-Forwarded-For does not buy more password guesses for one account', async () => {
    const { signInWithPassword } = await import('@/lib/actions/auth')
    const email = `victim-${Date.now()}@citykart.org`
    const results: (string | undefined)[] = []
    for (let i = 0; i < 12; i++) {
      forwarded = `10.${i}.0.1` // a different "client address" every time
      const fd = new FormData(); fd.set('email', email); fd.set('password', 'wrong-' + i)
      results.push(((await signInWithPassword(fd)) as { error?: string }).error)
    }
    expect(results.slice(0, 10).every((e) => e === 'Invalid login credentials.' || /credentials/i.test(e ?? ''))).toBe(true)
    expect(results[10]).toMatch(/Too many login attempts/)
    expect(results[11]).toMatch(/Too many login attempts/)
  })
  it('one account being tried does not lock out a different account', async () => {
    const { signInWithPassword } = await import('@/lib/actions/auth')
    const fd = new FormData(); fd.set('email', `someone-else-${Date.now()}@citykart.org`); fd.set('password', 'x')
    expect(((await signInWithPassword(fd)) as { error?: string }).error).not.toMatch(/Too many/)
  })
})

describe('forgot password is limited per address being mailed', () => {
  it('four requests for one address from four different callers send three e-mails', async () => {
    const { forgotPassword } = await import('@/lib/actions/auth')
    const email = `mailbomb-${Date.now()}@citykart.org`
    const out: { error?: string; success?: boolean }[] = []
    for (let i = 0; i < 4; i++) {
      forwarded = `172.16.${i}.9`
      const fd = new FormData(); fd.set('email', email)
      out.push((await forgotPassword(fd)) as { error?: string; success?: boolean })
    }
    expect(out.map((o) => !!o.success)).toEqual([true, true, true, false])
    expect(mailed).toHaveLength(3)
  })
})
