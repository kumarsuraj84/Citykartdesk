// System Log, application side, against the real audit database: the structured logger, the error sanitizer, failed calls to the database,
// Next's request-error hook, audit records with the real actor, and flood control. Rows are read back through the server key.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { svc, login, ORG_A, type Session } from './helpers'

// the System Log recorder is a no-op under Vitest unless a test opts in; these tests read what it wrote
process.env.SYSTEM_LOG_IN_TESTS = '1'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn().mockRejectedValue(new Error('outside a request')) }))

import { logger } from '@/lib/observability/logger'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { flushSystemLog, recordSystemLog } from '@/lib/syslog/record'
import { recordAudit } from '@/lib/syslog/audit'
import { recordRequestError, reportFailedCall } from '@/lib/syslog/process'
import { setFailureReporter } from '@/lib/syslog/failure-reporter'
import { signVerifiedUser } from '@/lib/auth/verified-user'
import { createAdminClient } from '@/lib/supabase/admin'

const tag = `cap${Date.now()}`
let admin: Session
type Row = { id: number; category: string; source: string; severity: string; outcome: string; action: string; message: string | null; error_code: string | null; fingerprint: string | null; actor_id: string | null; actor_role: string | null; org_id: string | null; request_id: string | null; path: string | null; method: string | null; row_hash: string | null; before_data: unknown; after_data: unknown; detail: Record<string, unknown> | null; stack: string | null }
const read = async (like: string) => (await svc<Row[]>('GET', `/system_log?or=(action.like.${like}*,message.like.*${like}*)&order=id.asc`)).json
const settle = async () => { await new Promise((r) => setTimeout(r, 300)); await flushSystemLog() }

beforeAll(async () => { admin = await login('admin1@audit.test'); setFailureReporter(reportFailedCall) })
afterAll(() => setFailureReporter(null))

describe('logger and sanitizer', () => {
  it('a logged error is stored with its source, a fingerprint, and a redacted message', async () => {
    logger.error({ event: `${tag}.email.send_failed`, message: `could not mail suraj@citykart.org with token=abc123def456`, route: 'lib/email/send.ts', context: { password: 'x', ok: 1 } })
    await settle()
    const [r] = await read(`${tag}.email.send_failed`)
    expect(r).toMatchObject({ category: 'error', source: 'integration', severity: 'error', outcome: 'failure' })
    expect(r.message).toBe('could not mail [email] with token=[redacted]')
    expect(r.fingerprint).toMatch(/^[0-9a-f]{14}$/)
    expect(r.detail).toEqual({ password: '[redacted]', ok: 1 })
    expect(r.org_id).toBe(ORG_A)             // the only organization on this server
    expect(r.row_hash).toBeNull()            // errors are not chained
  })
  it('sanitizeError records the REAL error (with its database code) while the user gets only the safe message', async () => {
    const safe = sanitizeError({ code: '23503', message: `${tag} insert or update violates foreign key constraint "x_fkey"` }, { route: 'requests.ts#assignRequest' })
    expect(safe).not.toContain('foreign key')
    await settle()
    const rows = await read(tag)
    const r = rows.find((x) => x.error_code === '23503')!
    expect(r).toMatchObject({ category: 'error', source: 'server_action', severity: 'warning' })   // 23503 is an "expected" code: a warning
    expect(r.message).toContain('violates foreign key constraint')
  })
  it('a permission denial (42501) is a security event with outcome denied', async () => {
    sanitizeError({ code: '42501', message: `${tag} new row violates row-level security policy` }, { route: 'x.ts#y' })
    await settle()
    const r = (await read(tag)).find((x) => x.error_code === '42501')!
    expect(r).toMatchObject({ category: 'security', outcome: 'denied' })
  })
})

describe('failed calls to the database', () => {
  it('a real PostgREST failure seen through the app\'s own client is recorded; an expected "no row" is not', async () => {
    const db = createAdminClient() as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { single: () => Promise<unknown> } & Promise<unknown> } } }
    await db.from(`no_such_table_${tag}`).select('id').eq('id', 'x')                     // 404 PGRST205: the table does not exist
    await db.from('requests').select('id').eq('id', '00000000-0000-0000-0000-00000000dead').single()   // 406 PGRST116: no row (expected)
    await new Promise((r) => setTimeout(r, 500)); await settle()
    const rows = (await svc<Row[]>('GET', `/system_log?message=like.*no_such_table_${tag}*&order=id.asc`)).json
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]).toMatchObject({ category: 'error', source: 'database', severity: 'error' })
    expect(rows[0].error_code).toMatch(/^PGRST2\d\d$/)
    expect(rows[0].detail).toMatchObject({ status: 404, method: 'GET' })
    expect(JSON.stringify(rows[0])).not.toContain('apikey')
    const noRow = (await svc<Row[]>('GET', `/system_log?error_code=eq.PGRST116&created_at=gte.${new Date(Date.now() - 20_000).toISOString()}`)).json
    expect(noRow).toHaveLength(0)
  })
  it('a call that cannot connect is recorded with the connection error', async () => {
    reportFailedCall({ url: `http://127.0.0.1:1/rest/v1/requests?select=id&apikey=secret${tag}`, method: 'GET', error: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), ms: 12 })
    await settle()
    const r = (await read('database.call_failed')).find((x) => (x.message ?? '').includes('127.0.0.1:1'))!
    expect(r).toMatchObject({ source: 'database', error_code: 'ECONNREFUSED', severity: 'error' })
    expect(JSON.stringify(r)).not.toContain(`secret${tag}`)               // the query string (which can hold keys) is never stored
  })
})

describe('unhandled errors reported by Next', () => {
  it('a server-action error carries the request id, path, method and the signed-in user (from the proxy-signed header)', async () => {
    const sig = signVerifiedUser(admin.id)!
    await recordRequestError(Object.assign(new Error(`${tag} boom in action`), { digest: 'D123' }),
      { path: '/requests/abc?token=zzz', method: 'POST', headers: { 'x-request-id': `req-${tag}`, 'x-verified-user-id': admin.id, 'x-verified-user-sig': sig, 'user-agent': 'UnitTest/1.0' } },
      { routerKind: 'App Router', routePath: '/requests/[id]', routeType: 'action' })
    await settle()
    const r = (await read('request.action_error')).find((x) => x.request_id === `req-${tag}`)!
    expect(r).toMatchObject({ category: 'error', source: 'server_action', severity: 'error', error_code: 'D123', path: '/requests/abc', method: 'POST', actor_id: admin.id, actor_role: 'admin', org_id: ORG_A })
    expect(r.stack).toContain('boom in action')
  })
  it('a redirect or not-found is not an error', async () => {
    await recordRequestError(Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;/${tag};307;` }), { path: '/x', method: 'GET', headers: {} }, { routeType: 'render' })
    await settle()
    expect((await read('request.render_error')).filter((x) => (x.path ?? '') === '/x' && x.error_code?.includes(tag))).toHaveLength(0)
  })
})

describe('audit records written by the application', () => {
  it('carry the actor, their role and organization, before / after, and are chained', async () => {
    await recordAudit({ action: `${tag}.user.role_changed`, entityType: 'user', entityId: admin.id, entityLabel: 'admin1', before: { role: 'admin', email: 'a@b.com' }, after: { role: 'manager', password: 'x' }, actorId: admin.id, category: 'security' })
    const [r] = await read(`${tag}.user.role_changed`)
    expect(r).toMatchObject({ category: 'security', source: 'server_action', outcome: 'success', actor_id: admin.id, actor_role: 'admin', org_id: ORG_A })
    expect(r.before_data).toEqual({ role: 'admin', email: 'a@b.com' })         // evidence is kept readable
    expect(r.after_data).toEqual({ role: 'manager', password: '[redacted]' })   // secrets never
    expect(r.row_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('flood control', () => {
  it('twenty identical failures are stored as ten, and an audit record is never dropped', async () => {
    for (let i = 0; i < 20; i++) void recordSystemLog({ category: 'error', source: 'app_server', action: `${tag}.flood`, message: `the same thing failed ${i}`, errorCode: 'X1' })
    for (let i = 0; i < 12; i++) void recordSystemLog({ category: 'audit', source: 'server_action', action: `${tag}.audit_burst`, message: `change ${i}` })
    await new Promise((r) => setTimeout(r, 800)); await settle()
    expect((await read(`${tag}.flood`)).length).toBe(10)
    expect((await read(`${tag}.audit_burst`)).length).toBe(12)
  })
})
