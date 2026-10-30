// G-01: the System Log ingest accepts the cron secret, but ONLY for entries whose source is 'cron'. G-25: the cron secret has a 16-character minimum and a failed-attempt limiter.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const recorded: Record<string, unknown>[] = []
vi.mock('@/lib/syslog/record', () => ({
  recordSystemLog: vi.fn(async (e: Record<string, unknown>) => { recorded.push(e) }),
  flushSystemLog: vi.fn(async () => {}),
}))

const ENV = ['CRON_SECRET', 'SYSTEM_LOG_INGEST_SECRET', 'ALLOW_SHARED_SECRET_FALLBACK', 'TRUSTED_PROXY_HOPS'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }; recorded.length = 0 })
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

const CRON = 'cron-secret-value-0123456789'
const INGEST = 'ingest-secret-value-0123456789'
const post = (entries: unknown[], headers: Record<string, string>) =>
  new NextRequest('http://localhost/api/system-log/ingest', { method: 'POST', body: JSON.stringify({ entries }), headers })

describe('POST /api/system-log/ingest', () => {
  it('the cron secret may add a cron entry', async () => {
    process.env.CRON_SECRET = CRON
    const { POST } = await import('@/app/api/system-log/ingest/route')
    const res = await POST(post([{ source: 'cron', action: 'cron.job_failed', message: 'alerts: HTTP 500' }], { 'x-cron-secret': CRON }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, accepted: 1 })
    expect(recorded[0]).toMatchObject({ source: 'cron', category: 'error' })
  })
  it('the cron secret may NOT add anything from another source (a database / auth / storage line, or an unknown source)', async () => {
    process.env.CRON_SECRET = CRON
    const { POST } = await import('@/app/api/system-log/ingest/route')
    const res = await POST(post([{ source: 'database', action: 'x' }, { action: 'no source' }, { source: 'admin', action: 'y' }], { 'x-cron-secret': CRON }))
    expect(res.status).toBe(403)
    expect(recorded).toEqual([])
    // mixed: the cron one is kept, the rest are refused and counted
    const mixed = await POST(post([{ source: 'cron', action: 'a' }, { source: 'storage', action: 'b' }], { 'x-cron-secret': CRON }))
    expect(await mixed.json()).toEqual({ ok: true, accepted: 1, refused: 1 })
    expect(recorded).toHaveLength(1)
  })
  it('the shipper\'s own secret may add any allowed source', async () => {
    process.env.CRON_SECRET = CRON
    process.env.SYSTEM_LOG_INGEST_SECRET = INGEST
    const { POST } = await import('@/app/api/system-log/ingest/route')
    const res = await POST(post([{ source: 'database', action: 'pg.timeout' }, { source: 'cron', action: 'c' }], { 'x-system-log-secret': INGEST }))
    expect(await res.json()).toEqual({ ok: true, accepted: 2 })
  })
  it('a wrong secret is 401; nothing configured is 503; a cron secret under 16 characters does not count', async () => {
    const { POST } = await import('@/app/api/system-log/ingest/route')
    expect((await POST(post([], {}))).status).toBe(503)
    process.env.CRON_SECRET = 'short-secret'
    expect((await POST(post([], { 'x-cron-secret': 'short-secret' }))).status).toBe(503)
    process.env.CRON_SECRET = CRON
    expect((await POST(post([], { 'x-cron-secret': 'wrong-secret-value-0123456789' }))).status).toBe(401)
  })
})

describe('verifyCronSecret (G-25)', () => {
  const req = (secret: string, ip = '') => new NextRequest('http://localhost/api/alerts/run', { headers: { 'x-cron-secret': secret, ...(ip ? { 'x-forwarded-for': ip } : {}) } })

  it('accepts the right secret in either header and refuses a wrong one', async () => {
    process.env.CRON_SECRET = CRON
    const { verifyCronSecret } = await import('@/lib/cron-auth')
    expect(verifyCronSecret(req(CRON))).toBe(true)
    expect(verifyCronSecret(new NextRequest('http://localhost/x', { headers: { authorization: `Bearer ${CRON}` } }))).toBe(true)
    expect(verifyCronSecret(req('nope'))).toBe(false)
  })
  it('a secret shorter than 16 characters counts as not configured (null)', async () => {
    process.env.CRON_SECRET = 'too-short'
    const { verifyCronSecret } = await import('@/lib/cron-auth')
    expect(verifyCronSecret(req('too-short'))).toBeNull()
  })
  it('too many wrong guesses from one caller pause that caller, even for the right secret, but not other callers', async () => {
    process.env.CRON_SECRET = CRON
    process.env.TRUSTED_PROXY_HOPS = '1'
    const { verifyCronSecret } = await import('@/lib/cron-auth')
    for (let i = 0; i < 30; i++) expect(verifyCronSecret(req(`guess-${i}-padding-padding`, '203.0.113.9'))).toBe(false)
    expect(verifyCronSecret(req(CRON, '203.0.113.9'))).toBe(false)         // paused
    expect(verifyCronSecret(req(CRON, '198.51.100.4'))).toBe(true)         // another caller is fine
  })
})
