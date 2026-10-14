// System Log endpoints against the real audit database: the secret-protected ingest (cron runner, log shipper), the archive job, and the browser
// events route (only browser kinds are accepted; errors are mirrored into the log with the click that preceded them).

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { svc, login, ORG_A, type Session } from './helpers'
import { signVerifiedUser } from '@/lib/auth/verified-user'

vi.mock('server-only', () => ({}))
const hdrs = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => hdrs.current }))

import { POST as ingest } from '@/app/api/system-log/ingest/route'
import { GET as archive } from '@/app/api/system-log/archive/route'
import { POST as events } from '@/app/api/events/route'
import { flushSystemLog } from '@/lib/syslog/record'

const tag = `ep${Date.now()}`
const secret = () => process.env.CRON_SECRET!
type Row = { id: number; category: string; source: string; severity: string; action: string; message: string | null; actor_id: string | null; org_id: string | null; from_click: boolean | null; click_target: string | null; path: string | null; row_hash: string | null; user_agent: string | null; session_id: string | null }
const rows = async (like: string) => (await svc<Row[]>('GET', `/system_log?action=like.${like}*&order=id.asc`)).json
const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers })
let user: Session

beforeAll(async () => { user = await login('staff1@audit.test') })

describe('ingest', () => {
  it('refuses a missing or wrong secret, and accepts the shared secret in either header', async () => {
    expect((await ingest(post('/api/system-log/ingest', { entries: [] }))).status).toBe(401)
    expect((await ingest(post('/api/system-log/ingest', { entries: [] }, { 'x-system-log-secret': 'wrong-secret-value-123456' }))).status).toBe(401)
    expect((await ingest(post('/api/system-log/ingest', { entries: [] }, { 'x-system-log-secret': secret() }))).status).toBe(200)
    expect((await ingest(post('/api/system-log/ingest', { entries: [] }, { 'x-cron-secret': secret() }))).status).toBe(200)
  })
  it('stores error rows from the cron runner and the shipper', async () => {
    const res = await ingest(post('/api/system-log/ingest', { entries: [
      { category: 'error', source: 'cron', severity: 'error', action: `${tag}.cron.job_failed`, message: 'alerts: HTTP 502', errorCode: '502', detail: { job: 'alerts' } },
      { source: 'database', action: `${tag}.postgrest.timeout`, message: 'canceling statement due to statement timeout', errorCode: '57014', stack: 'at x' },
    ] }, { 'x-cron-secret': secret() }))
    expect(await res.json()).toEqual({ ok: true, accepted: 2 })
    const a = (await rows(`${tag}.cron`))[0], b = (await rows(`${tag}.postgrest`))[0]
    expect(a).toMatchObject({ category: 'error', source: 'cron', severity: 'error' })
    expect(b).toMatchObject({ category: 'error', source: 'database' })
  })
  it('cannot be used to forge the audit trail, an identity or an organization, and an unknown source is the shipper', async () => {
    await ingest(post('/api/system-log/ingest', { entries: [{ category: 'audit', source: 'admin', action: `${tag}.forged`, message: 'x', actorId: user.id, orgId: ORG_A, severity: 'nonsense' }] }, { 'x-cron-secret': secret() }))
    const r = (await rows(`${tag}.forged`))[0]
    expect(r.category).toBe('error')              // not audit
    expect(r.row_hash).toBeNull()                 // never chained
    expect(r.source).toBe('shipper')              // 'admin' is not an allowed ingest source
    expect(r.severity).toBe('error')
    expect(r.actor_id).toBeNull()
  })
  it('rejects oversized and malformed bodies, and takes at most 200 entries', async () => {
    expect((await ingest(post('/api/system-log/ingest', 'x'.repeat(600_000), { 'x-cron-secret': secret() }))).status).toBe(413)
    expect((await ingest(post('/api/system-log/ingest', '{not json', { 'x-cron-secret': secret() }))).status).toBe(400)
    expect((await ingest(post('/api/system-log/ingest', { entries: 'nope' }, { 'x-cron-secret': secret() }))).status).toBe(400)
    const many = Array.from({ length: 250 }, (_, i) => ({ source: 'shipper', action: `${tag}.bulk${i}`, message: `bulk row number ${i} with distinct text ${'abcdefghij'.charAt(i % 10)}${i}`, errorCode: `B${i}` }))
    const out = await (await ingest(post('/api/system-log/ingest', { entries: many }, { 'x-cron-secret': secret() }))).json()
    expect(out.accepted).toBe(200)
  })
})

describe('archive job', () => {
  it('needs the cron secret; moves old errors, keeps recent rows, and records that it did', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
    await svc('POST', '/system_log', { org_id: ORG_A, category: 'error', source: 'app_server', severity: 'error', outcome: 'failure', action: `${tag}.old_error`, created_at: old })
    expect((await archive(new NextRequest('http://localhost/api/system-log/archive'))).status).toBe(401)
    const res = await archive(new NextRequest('http://localhost/api/system-log/archive', { headers: { 'x-cron-secret': secret() } }))
    const out = await res.json()
    expect(out).toMatchObject({ ok: true, errorDays: 180, auditYears: 7 })
    expect(out.moved).toBeGreaterThanOrEqual(1)
    await flushSystemLog()
    expect(await rows(`${tag}.old_error`)).toHaveLength(0)
    expect((await svc<unknown[]>('GET', `/system_log_archive?action=eq.${tag}.old_error`)).json).toHaveLength(1)
    expect((await svc<Row[]>('GET', '/system_log?action=eq.system_log.archived&order=id.desc&limit=1')).json[0]).toMatchObject({ category: 'audit', source: 'cron' })
  })
})

describe('browser events route', () => {
  const asUser = (extra: Record<string, string> = {}) => {
    hdrs.current = new Headers({ 'x-verified-user-id': user.id, 'x-verified-user-sig': signVerifiedUser(user.id)!, 'user-agent': 'Browser/9', ...extra })
  }
  it('is closed to someone who is not signed in', async () => {
    hdrs.current = new Headers()
    expect((await events(post('/api/events', { events: [{ kind: 'click' }] }))).status).toBe(401)
  })
  it('accepts only what a browser can observe: a signed-in user cannot add server_error or system rows', async () => {
    asUser()
    await events(post('/api/events', { sessionId: `sess-${tag}`, events: [
      { kind: 'server_error', message: `${tag} forged server error` },
      { kind: 'system', message: `${tag} forged system event` },
      { kind: 'click', path: '/home', target: `${tag} button:ok` },
    ] }))
    const forged = (await svc<unknown[]>('GET', `/app_event_log?message=like.*${tag}*&kind=in.(server_error,system)`)).json
    expect(forged).toHaveLength(0)
    expect((await svc<unknown[]>('GET', `/app_event_log?target=like.*${tag}*&kind=eq.click`)).json).toHaveLength(1)
  })
  it('mirrors a browser error into the System Log with the page, the user and the click that preceded it', async () => {
    asUser()
    await events(post('/api/events', { sessionId: `sess-${tag}`, events: [
      { kind: 'js_error', path: '/requests/abc', message: `${tag} Cannot read properties of undefined`, detail: { click: { target: 'button:Start Working', ms: 800 }, stack: 'at Foo (app.js:1:1)' } },
      { kind: 'render_error', path: '/home', message: `${tag} render failed`, detail: { click: null, digest: 'DIG9' } },
    ] }))
    await new Promise((r) => setTimeout(r, 400))   // the rows are queued in the background after the response
    await flushSystemLog()
    const list = (await svc<Row[]>('GET', `/system_log?message=like.*${tag}*&source=eq.browser&order=id.asc`)).json
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ category: 'error', source: 'browser', action: 'browser.js_error', actor_id: user.id, path: '/requests/abc', from_click: true, click_target: 'button:Start Working', user_agent: 'Browser/9', session_id: `sess-${tag}` })
    expect(list[1]).toMatchObject({ action: 'browser.render_error', from_click: false, org_id: ORG_A })
  })
})
