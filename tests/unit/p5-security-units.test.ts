// Small pure pieces added by the P5 fixes: the test-run guard (H-02), password rules (A-09), what a sign-in attempt may leave in the audit trail (A-16), the avatar
// address check (A-15), the build id (G-27), start-up warnings (G-10 / H-28), the DNS check of a mail host (A-21), the complete account scan (A-24), the
// progressive sign-in wait (A-04) and the refused permission-matrix writes (A-18).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertLocalSupabase, isLoopbackHost } from '../setup/local-guard'
import { validateNewPassword, passwordClasses } from '@/lib/security/password-policy'
import { redactLoginName } from '@/lib/security/login-name'
import { isOwnAvatarUrl } from '@/lib/storage/publicPath'
import { parseBuildId } from '@/lib/http/build-info'
import { startupWarnings } from '@/lib/observability/startup-check'
import { isForbiddenMailAddress, mailHostProblemResolved } from '@/lib/validation/mail-host'
import { findAuthUserByEmail, listAuthEmails } from '@/lib/auth/emails'
import { progressiveWaitMs, recordProgressiveFailure, clearProgressive } from '@/lib/rate-limit'
import { sliceStream } from '@/lib/attachments/stream'

describe('assertLocalSupabase (H-02)', () => {
  it('accepts addresses on this machine', () => {
    for (const u of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://host.docker.internal:8000', 'https://LOCALHOST']) {
      expect(() => assertLocalSupabase({ NEXT_PUBLIC_SUPABASE_URL: u, SUPABASE_URL: u }), u).not.toThrow()
    }
  })
  it('refuses the production address and any other host, naming the variable', () => {
    expect(() => assertLocalSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'http://10.0.1.98:8443' })).toThrow(/NEXT_PUBLIC_SUPABASE_URL.*10\.0\.1\.98/)
    expect(() => assertLocalSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_URL: 'https://x.example.com' })).toThrow(/SUPABASE_URL/)
    expect(() => assertLocalSupabase({ SUPABASE_URL: 'not a url' })).toThrow(/not a valid address/)
    expect(() => assertLocalSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1.evil.com:54321' })).toThrow()
  })
  it('ALLOW_NON_LOCAL_TESTS=1 overrides on purpose; unset addresses have nothing to protect', () => {
    expect(() => assertLocalSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'http://10.0.1.98:8443', ALLOW_NON_LOCAL_TESTS: '1' })).not.toThrow()
    expect(() => assertLocalSupabase({})).not.toThrow()
    expect(isLoopbackHost('10.0.0.5')).toBe(false)
  })
})

describe('validateNewPassword (A-09)', () => {
  it('accepts 10+ characters with 3 of the 4 kinds', () => {
    for (const p of ['Abcdefghi1', 'abcdefgh1!', 'ABCDEFGH1!', 'a-new-password-1', 'Temp-Reset#2026']) expect(validateNewPassword(p), p).toBeNull()
  })
  it('refuses short, too simple, empty and over-long ones with a sentence', () => {
    expect(validateNewPassword('Ab1!')).toMatch(/at least 10/)
    expect(validateNewPassword('abcdefghijkl')).toMatch(/too simple/)
    expect(validateNewPassword('abcdefgh12')).toMatch(/too simple/)      // two kinds only
    expect(validateNewPassword('')).toMatch(/Enter a password/)
    expect(validateNewPassword(undefined)).toMatch(/Enter a password/)
    expect(validateNewPassword('Aa1!'.repeat(40))).toMatch(/at most 128/)
    expect(passwordClasses('aA1!')).toBe(4)
  })
})

describe('redactLoginName (A-16)', () => {
  it('keeps an e-mail address (lower-cased) and fingerprints anything else', () => {
    expect(redactLoginName('  Store.NLD@Citykart.org ')).toBe('store.nld@citykart.org')
    const typedPassword = redactLoginName('Welcome@citykart@123')            // a password typed in the e-mail box
    expect(typedPassword).not.toContain('Welcome')
    expect(typedPassword).toMatch(/fingerprint [0-9a-f]{10}\)/)
    expect(redactLoginName('Welcome@citykart@123')).toBe(typedPassword)       // the same text gives the same fingerprint
    expect(redactLoginName('')).toBe('(empty)')
    expect(redactLoginName(null)).toBe('(empty)')
  })
})

describe('scrubTypedLogin (audit trail, A-16)', async () => {
  const { scrubTypedLogin } = await import('@/lib/syslog/audit')
  it('replaces a typed login that is not an e-mail address wherever it sits in a security entry, and leaves everything else alone', () => {
    const out = scrubTypedLogin({ email: 'hunter2-Secret!', nested: { login: 'a@b.com', other: 'hunter2-Secret!' }, list: [{ email: 'x y z' }] }) as Record<string, unknown>
    expect((out as { email: string }).email).not.toContain('hunter2')
    expect(JSON.stringify((out as { list: unknown }).list)).not.toContain('x y z')
    expect((out.nested as Record<string, string>).login).toBe('a@b.com')
    expect(JSON.stringify(out)).toContain('"other":"hunter2-Secret!"')        // only keys that hold typed login text are touched
  })
})

describe('isOwnAvatarUrl (A-15)', () => {
  const me = '3f2b8c1e-5d4a-4b7e-9c1a-0e6f2d8a7b31'
  const other = '99999999-5d4a-4b7e-9c1a-0e6f2d8a7b31'
  it('accepts exactly the address uploadAvatar writes for this person, and an empty value (clears the picture)', () => {
    expect(isOwnAvatarUrl(`/api/storage/public/avatars/${me}/avatar.png`, me)).toBe(true)
    expect(isOwnAvatarUrl(`/api/storage/public/avatars/${me}/avatar.JPEG`, me)).toBe(true)
    expect(isOwnAvatarUrl('', me)).toBe(true)
  })
  it('refuses outside addresses, other people\'s folders, other buckets, traversal and non-strings', () => {
    for (const v of ['https://evil.example/x.png', `/api/storage/public/avatars/${other}/avatar.png`, `/api/storage/public/icons/${me}.png`, `/api/storage/public/avatars/${me}/../${other}/avatar.png`,
      `/api/storage/public/avatars/${me}/avatar.svg`, `javascript:alert(1)`, `/api/storage/public/avatars/${me}/avatar.png?x=1`, null, 5]) {
      expect(isOwnAvatarUrl(v, me), String(v)).toBe(false)
    }
    expect(isOwnAvatarUrl(`/api/storage/public/avatars/${me}/avatar.png`, 'not-a-uuid')).toBe(false)
  })
})

describe('parseBuildId (G-27)', () => {
  it('reads the commit out of a stamped build id', () => {
    expect(parseBuildId('20261029-140221-a709299')).toEqual({ buildId: '20261029-140221-a709299', commit: 'a709299' })
    expect(parseBuildId('20261029-140221-a709299-dirty')).toEqual({ buildId: '20261029-140221-a709299-dirty', commit: 'a709299' })
  })
  it('older and development ids have no commit', () => {
    expect(parseBuildId('20261006-0900')).toEqual({ buildId: '20261006-0900' })
    expect(parseBuildId(undefined)).toEqual({ buildId: 'dev' })
    expect(parseBuildId('  ')).toEqual({ buildId: 'dev' })
  })
})

describe('startupWarnings (G-10 / H-28)', () => {
  const good = { TZ: 'Asia/Kolkata', CRON_SECRET: 'a'.repeat(20), SYSTEM_LOG_INGEST_SECRET: 'b'.repeat(20), APPROVAL_LINK_SECRET: 'c'.repeat(20), CSAT_LINK_SECRET: 'd'.repeat(20),
    OAUTH_STATE_SECRET: 'e'.repeat(20), INTAKE_WEBHOOK_TOKEN: 'f'.repeat(20), INTAKE_WORKER_SECRET: 'g'.repeat(20), TRUSTED_PROXY_HOPS: '1' }
  it('is silent when everything is in order', () => { expect(startupWarnings(good, 'Asia/Kolkata')).toEqual([]) })
  it('warns about a wrong time zone, naming both', () => {
    const w = startupWarnings(good, 'UTC')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/"UTC".*Asia\/Kolkata/)
    expect(startupWarnings(good, 'Asia/Calcutta')).toEqual([])               // the old name of the same zone
  })
  it('names each missing / short / repeated secret and the proxy setting, and never prints a value', () => {
    const w = startupWarnings({ ...good, CRON_SECRET: 'short', CSAT_LINK_SECRET: good.APPROVAL_LINK_SECRET, SYSTEM_LOG_INGEST_SECRET: '', TRUSTED_PROXY_HOPS: undefined }, 'Asia/Kolkata').join('\n')
    expect(w).toMatch(/CRON_SECRET is shorter than 16/)
    expect(w).toMatch(/CSAT_LINK_SECRET is the same value as APPROVAL_LINK_SECRET/)
    expect(w).toMatch(/SYSTEM_LOG_INGEST_SECRET is not set/)
    expect(w).toMatch(/TRUSTED_PROXY_HOPS/)
    expect(w).not.toContain('a'.repeat(20))
  })
})

describe('mail host DNS check (A-21)', () => {
  it('classifies addresses', () => {
    for (const a of ['127.0.0.1', '127.9.9.9', '0.0.0.0', '169.254.169.254', '::1', '::', 'fe80::1', '::ffff:127.0.0.1', '[::1]', 'ff02::1', '224.0.0.1']) expect(isForbiddenMailAddress(a), a).toBe(true)
    for (const a of ['10.0.0.25', '192.168.1.5', '172.16.0.9', '142.250.1.1', '2607:f8b0:4004:c07::6c', '::ffff:10.0.0.1']) expect(isForbiddenMailAddress(a), a).toBe(false)
  })
  it('refuses a name that resolves to this computer or a reserved address, even among several answers', async () => {
    const lookup = async (h: string) => (h === 'evil.example.com' ? [{ address: '142.250.1.1' }, { address: '127.0.0.1' }] : h === 'meta.example.com' ? [{ address: '169.254.169.254' }] : [{ address: '142.250.1.1' }])
    expect(await mailHostProblemResolved('evil.example.com', lookup)).toMatch(/points at this computer/)
    expect(await mailHostProblemResolved('meta.example.com', lookup)).toMatch(/points at this computer/)
    expect(await mailHostProblemResolved('smtp.gmail.com', lookup)).toBeNull()
  })
  it('keeps allowing private LAN addresses and names, does not look up a typed address, and tolerates a name that does not resolve', async () => {
    const calls: string[] = []
    const lookup = async (h: string) => { calls.push(h); if (h === 'nowhere.example.com') throw new Error('ENOTFOUND'); return [{ address: '10.0.0.25' }] }
    expect(await mailHostProblemResolved('mail-relay', lookup)).toBeNull()
    expect(await mailHostProblemResolved('10.0.0.25', lookup)).toBeNull()
    expect(calls).toEqual(['mail-relay'])
    expect(await mailHostProblemResolved('nowhere.example.com', lookup)).toBeNull()
    expect(await mailHostProblemResolved('localhost', lookup)).toMatch(/\S/)       // the written-form rules still apply first
  })
})

describe('the complete account scan (A-24)', () => {
  const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${from + i}`, email: `User${from + i}@Citykart.org` }))
  const adminWith = (pages: Record<number, { users: { id: string; email: string }[] } | Error | { error: string }>) => ({
    auth: { admin: { listUsers: async ({ page: p }: { page: number }) => {
      const v = pages[p] ?? { users: [] }
      if (v instanceof Error) throw v
      return 'error' in v ? { data: null, error: { message: v.error } } : { data: v, error: null }
    } } },
  })
  it('finds an address beyond the first 1000 accounts', async () => {
    const admin = adminWith({ 1: { users: page(0, 1000) }, 2: { users: page(1000, 1000) }, 3: { users: page(2000, 5) } })
    expect(await findAuthUserByEmail(admin, ' user2003@citykart.ORG ')).toEqual({ ok: true, value: { id: 'u2003', email: 'User2003@Citykart.org' } })
    expect(await findAuthUserByEmail(admin, 'nobody@citykart.org')).toEqual({ ok: true, value: null })
  })
  it('says so when the list cannot be read to the end (never "not found")', async () => {
    const failing = adminWith({ 1: { users: page(0, 1000) }, 2: { error: 'upstream 502' } })
    const r = await findAuthUserByEmail(failing, 'nobody@citykart.org')
    expect(r).toEqual({ ok: false, error: 'upstream 502' })
    const threw = adminWith({ 1: new Error('fetch failed') })
    expect((await findAuthUserByEmail(threw, 'x@y.org')).ok).toBe(false)
  })
  it('lists the e-mail addresses of chosen ids from every page', async () => {
    const admin = adminWith({ 1: { users: page(0, 1000) }, 2: { users: page(1000, 3) } })
    const r = await listAuthEmails(admin, ['u5', 'u1001'])
    expect(r.ok && [...r.value]).toEqual([['u5', 'user5@citykart.org'], ['u1001', 'user1001@citykart.org']])
  })
})

describe('progressive sign-in wait (A-04)', () => {
  beforeEach(() => clearProgressive('k'))
  it('costs nothing for the first nine wrong tries, then waits 30 s, 60 s, 120 s ... at most 5 minutes, and never forever', () => {
    const t0 = 1_000_000
    for (let i = 1; i <= 9; i++) expect(recordProgressiveFailure('k', {}, t0), `try ${i}`).toBe(0)
    expect(progressiveWaitMs('k', t0)).toBe(0)
    expect(recordProgressiveFailure('k', {}, t0)).toBe(30_000)          // the 10th
    expect(progressiveWaitMs('k', t0 + 1)).toBe(29_999)
    expect(progressiveWaitMs('k', t0 + 30_001)).toBe(0)                 // it ends by itself
    expect(recordProgressiveFailure('k', {}, t0 + 31_000)).toBe(60_000)
    expect(recordProgressiveFailure('k', {}, t0 + 100_000)).toBe(120_000)
    for (let i = 0; i < 10; i++) recordProgressiveFailure('k', {}, t0 + 200_000)
    expect(recordProgressiveFailure('k', {}, t0 + 200_000)).toBe(300_000)   // capped
  })
  it('a correct sign-in, or a quiet half hour, starts the count again', () => {
    for (let i = 0; i < 12; i++) recordProgressiveFailure('k', {}, 5_000_000)
    clearProgressive('k')
    expect(progressiveWaitMs('k', 5_000_001)).toBe(0)
    for (let i = 0; i < 12; i++) recordProgressiveFailure('k', {}, 6_000_000)
    expect(recordProgressiveFailure('k', {}, 6_000_000 + 31 * 60_000)).toBe(0)
  })
})

describe('sliceStream', () => {
  it('passes on exactly the wanted bytes across chunk borders', async () => {
    const chunks = ['0123', '4567', '89ab', 'cdef'].map((s) => new TextEncoder().encode(s))
    const src = () => new ReadableStream<Uint8Array>({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close() } })
    const read = async (s: ReadableStream<Uint8Array>) => new TextDecoder().decode(new Uint8Array((await new Response(s).arrayBuffer())))
    expect(await read(sliceStream(src(), 3, 9))).toBe('3456789')
    expect(await read(sliceStream(src(), 0, 0))).toBe('0')
    expect(await read(sliceStream(src(), 14, 15))).toBe('ef')
    expect(await read(sliceStream(src(), 10, 100))).toBe('abcdef')
  })
})

describe('the permission-matrix actions refuse while the matrix is not enforced (A-18)', () => {
  beforeEach(() => vi.resetModules())
  it('save, create and delete all answer "not switched on" and touch nothing', async () => {
    const touched: string[] = []
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }))
    vi.doMock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => { touched.push('profile'); return { id: 'a', role: 'admin' } } }))
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => { touched.push('client'); return {} } }))
    const { savePermissionOverrides, createCustomRole, deleteCustomRole } = await import('@/lib/actions/admin/permissions')
    expect((await savePermissionOverrides([{ role_key: 'agent', action_key: 'x', allowed: true }])).error).toMatch(/not switched on/)
    expect((await createCustomRole({ name: 'n', description: 'd', base_role: 'agent' })).error).toMatch(/not switched on/)
    expect((await deleteCustomRole('id')).error).toMatch(/not switched on/)
    expect(touched).toEqual([])
  })
})
