// VAPT-032 / VAPT-041: sign-in throttling that follows failures (not successes), cannot be used to lock a person out from elsewhere when the address is known,
// slows password spraying, and a forgot-password answer that does not reveal whether an address has an account.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let forwarded = ''
let nextSignIn: 'ok' | 'fail' = 'fail'
vi.mock('next/headers', () => ({ headers: async () => ({ get: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? forwarded || null : null) }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => (nextSignIn === 'ok' ? { data: { user: { id: 'u1' } }, error: null } : { data: null, error: { message: 'Invalid login credentials' } }),
      signOut: async () => ({}),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_active: true } }) }) }) }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => null, getCurrentProfileForPasswordReset: async () => null }))
const known = new Set<string>()
vi.mock('@/lib/email/auth-mail', () => ({
  emailPasswordResetLink: async (email: string) => { if (known.has(email)) await new Promise((r) => setTimeout(r, 30)); return {} },
}))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: vi.fn(async () => {}) }))

const saved = { hops: process.env.TRUSTED_PROXY_HOPS, floor: process.env.FORGOT_PASSWORD_MIN_MS }
beforeEach(() => { delete process.env.TRUSTED_PROXY_HOPS; delete process.env.FORGOT_PASSWORD_MIN_MS; forwarded = ''; nextSignIn = 'fail' })
afterEach(() => {
  for (const [k, v] of [['TRUSTED_PROXY_HOPS', saved.hops], ['FORGOT_PASSWORD_MIN_MS', saved.floor]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

const form = (email: string, password = 'x') => { const fd = new FormData(); fd.set('email', email); fd.set('password', password); return fd }
async function tryLogin(email: string): Promise<string> {
  const { signInWithPassword } = await import('@/lib/actions/auth')
  try { return ((await signInWithPassword(form(email))) as { error?: string }).error ?? 'no error' } catch (e) { return String((e as Error).message) }
}

describe('sign-in throttling counts failures', () => {
  it('a person who signs in correctly many times never uses up their allowance', async () => {
    const email = `steady-${Date.now()}@citykart.org`
    nextSignIn = 'ok'
    for (let i = 0; i < 30; i++) expect(await tryLogin(email)).toMatch(/REDIRECT/)
    nextSignIn = 'fail'
    for (let i = 0; i < 10; i++) expect(await tryLogin(email)).toMatch(/credentials/i)       // ten wrong tries are still allowed after thirty good ones
    expect(await tryLogin(email)).toMatch(/Too many/)
  })

  it('with a trusted address, a stranger\'s wrong guesses do not lock the real person out from another address', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    const email = `victim-${Date.now()}@citykart.org`
    forwarded = '203.0.113.50'                                                          // the attacker
    for (let i = 0; i < 12; i++) await tryLogin(email)
    expect(await tryLogin(email)).toMatch(/Too many/)                                   // the attacker is blocked
    forwarded = '198.51.100.7'                                                          // the real person, elsewhere
    nextSignIn = 'ok'
    expect(await tryLogin(email)).toMatch(/REDIRECT/)
  })

  it('one address trying many different accounts is slowed down (password spraying)', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    forwarded = '203.0.113.77'
    const tag = Date.now()
    for (let i = 0; i < 40; i++) await tryLogin(`spray-${tag}-${i}@citykart.org`)
    expect(await tryLogin(`spray-${tag}-next@citykart.org`)).toMatch(/Too many/)
    forwarded = '198.51.100.9'                                                          // another address is not affected
    expect(await tryLogin(`spray-${tag}-other@citykart.org`)).toMatch(/credentials/i)
  })
})

describe('forgot password does not tell known from unknown addresses', () => {
  it('both answer in at least the same minimum time, and look the same', async () => {
    process.env.FORGOT_PASSWORD_MIN_MS = '250'
    const { forgotPassword } = await import('@/lib/actions/auth')
    const tag = Date.now()
    known.add(`known-${tag}@citykart.org`)
    const time = async (email: string) => {
      const t = performance.now()
      const fd = new FormData(); fd.set('email', email)
      const r = (await forgotPassword(fd)) as { success?: boolean; error?: string }
      return { ms: performance.now() - t, r }
    }
    const a = await time(`known-${tag}@citykart.org`)
    const b = await time(`unknown-${tag}@citykart.org`)
    expect(a.r).toEqual(b.r)
    expect(a.ms).toBeGreaterThanOrEqual(240)
    expect(b.ms).toBeGreaterThanOrEqual(240)
    expect(Math.abs(a.ms - b.ms)).toBeLessThan(80)
  })
})
