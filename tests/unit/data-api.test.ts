// The read-only data API for the data platform (DBA): parameters, cursor, the token check, and the privacy rules of every entity.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { encodeCursor, decodeCursor, parseParams, isoUtc, MAX_LIMIT, DEFAULT_LIMIT } from '@/lib/data-api/params'
import { verifyDataApiToken, hostAllowed, MIN_DATA_API_TOKEN } from '@/lib/data-api/auth'
import { ENTITIES, entityByName, type Ctx } from '@/lib/data-api/entities'
import { getSecret, auditSecrets } from '@/lib/secrets'
import { proxy } from '@/proxy'

const sp = (q: string) => new URLSearchParams(q)

describe('the cursor', () => {
  it('goes round and back', () => {
    const c = { t: '2026-11-02T04:00:00.123456Z', id: '0b6f2e0a-1111-4222-8333-444455556666' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor(encodeCursor({ t: null, id: 'abc' }))).toEqual({ t: null, id: 'abc' })
  })
  it('refuses a cursor that is not ours or carries filter characters', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: 'x),id.gt.0', i: 'a' })).toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: null, i: 'a,or(b)' })).toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: null })).toString('base64url'))).toBeNull()
  })
})

describe('the request parameters', () => {
  it('reads a normal request with the defaults', () => {
    expect(parseParams(sp('entity=requests'))).toEqual({ ok: true, entity: 'requests', limit: DEFAULT_LIMIT, since: null, after: null })
  })
  it('reads the limit, the date and the cursor', () => {
    const after = encodeCursor({ t: '2026-11-02T04:00:00Z', id: 'x1' })
    const p = parseParams(sp(`entity=stores&limit=${MAX_LIMIT}&updated_since=2026-11-01T00:00:00Z&after=${after}`))
    expect(p).toEqual({ ok: true, entity: 'stores', limit: MAX_LIMIT, since: '2026-11-01T00:00:00.000Z', after: { t: '2026-11-02T04:00:00Z', id: 'x1' } })
  })
  it('refuses a bad entity, limit, date or cursor with a clear sentence', () => {
    for (const q of ['', 'entity=Requests;drop', 'entity=requests&limit=0', `entity=requests&limit=${MAX_LIMIT + 1}`, 'entity=requests&limit=abc', 'entity=requests&updated_since=yesterday', 'entity=requests&after=zzz']) {
      const p = parseParams(sp(q))
      expect(p.ok, q).toBe(false)
      if (!p.ok) expect(p.error.length).toBeGreaterThan(10)
    }
  })
  it('writes database timestamps as ISO UTC with the database precision', () => {
    expect(isoUtc('2026-11-02T04:00:00.123456+00:00')).toBe('2026-11-02T04:00:00.123456Z')
    expect(isoUtc('2026-11-02 04:00:00+00')).toBe('2026-11-02T04:00:00Z')
    expect(isoUtc(null)).toBeNull()
  })
})

describe('the token check', () => {
  const KEYS = ['DATA_API_TOKEN', 'DATA_API_ALLOWED_HOSTS', 'CRON_SECRET', 'ALLOW_SHARED_SECRET_FALLBACK']
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })
  const req = (authorization?: string) => new NextRequest('http://localhost:3210/api/data/v1/rows?entity=requests', { headers: authorization ? { authorization } : {} })

  it('is OFF while no token is configured, or the token is short', () => {
    expect(verifyDataApiToken(req('Bearer anything'))).toBe('off')
    process.env.DATA_API_TOKEN = 'short'
    expect(verifyDataApiToken(req('Bearer short'))).toBe('off')
  })
  it('never borrows the cron secret, even with the transitional switch on', () => {
    process.env.CRON_SECRET = 'cron-secret-value-0123456789'
    process.env.ALLOW_SHARED_SECRET_FALLBACK = '1'
    expect(getSecret('data_api')).toBeNull()
    expect(verifyDataApiToken(req('Bearer cron-secret-value-0123456789'))).toBe('off')
  })
  it('accepts only the exact bearer token', () => {
    process.env.DATA_API_TOKEN = 'data-api-token-0123456789-abcdef'
    expect(verifyDataApiToken(req('Bearer data-api-token-0123456789-abcdef'))).toBe('ok')
    expect(verifyDataApiToken(req('Bearer data-api-token-0123456789-abcdeg'))).toBe('denied')
    expect(verifyDataApiToken(req('data-api-token-0123456789-abcdef'))).toBe('denied')
    expect(verifyDataApiToken(req())).toBe('denied')
    expect(verifyDataApiToken(new NextRequest('http://localhost:3210/x', { headers: { 'x-cron-secret': 'data-api-token-0123456789-abcdef' } }))).toBe('denied')
  })
  it('a token under 32 characters is refused as not configured', () => {
    process.env.DATA_API_TOKEN = 'x'.repeat(MIN_DATA_API_TOKEN - 1)
    expect(verifyDataApiToken(req('Bearer ' + 'x'.repeat(MIN_DATA_API_TOKEN - 1)))).toBe('off')
    process.env.DATA_API_TOKEN = 'x'.repeat(MIN_DATA_API_TOKEN)
    expect(verifyDataApiToken(req('Bearer ' + 'x'.repeat(MIN_DATA_API_TOKEN)))).toBe('ok')
  })
  it('a flood of wrong tokens never locks out the right one', () => {
    process.env.DATA_API_TOKEN = 'data-api-token-0123456789-abcdef'
    for (let i = 0; i < 60; i++) expect(verifyDataApiToken(req('Bearer wrong-' + i))).toBe('denied')
    expect(verifyDataApiToken(req('Bearer data-api-token-0123456789-abcdef'))).toBe('ok')
  })
  it('with a host list, a request for another host is answered "hidden" before the token is looked at', () => {
    process.env.DATA_API_TOKEN = 'data-api-token-0123456789-abcdef'
    process.env.DATA_API_ALLOWED_HOSTS = '10.0.1.98:3210, platform.internal:3210'
    const withHost = (host: string, authorization?: string) => new NextRequest('http://localhost:3210/api/data/v1/meta', { headers: { host, ...(authorization ? { authorization } : {}) } })
    expect(verifyDataApiToken(withHost('182.72.84.10:3210', 'Bearer data-api-token-0123456789-abcdef'))).toBe('hidden')
    expect(verifyDataApiToken(withHost('10.0.1.98:3210', 'Bearer data-api-token-0123456789-abcdef'))).toBe('ok')
    expect(verifyDataApiToken(withHost('10.0.1.98:3210', 'Bearer nope'))).toBe('denied')
    expect(hostAllowed(withHost('PLATFORM.internal:3210'), { DATA_API_ALLOWED_HOSTS: 'platform.internal:3210' })).toBe(true)
    expect(hostAllowed(withHost('x:1'), {})).toBe(true)
  })
  it('a missing token is not an audit problem, a short or shared one is', () => {
    expect(auditSecrets({}).some((i) => i.env === 'DATA_API_TOKEN')).toBe(false)
    expect(auditSecrets({ DATA_API_TOKEN: 'short' }).some((i) => i.env === 'DATA_API_TOKEN' && /shorter/.test(i.problem))).toBe(true)
    expect(auditSecrets({ DATA_API_TOKEN: 'same-value-same-value-1', CRON_SECRET: 'same-value-same-value-1' }).some((i) => /same value/.test(i.problem))).toBe(true)
  })
})

describe('the data API routes need no login session (they use their own token)', () => {
  it('are not redirected to /login', async () => {
    for (const r of ['/api/data/v1/meta', '/api/data/v1/rows', '/api/data/v1/ids']) {
      const res = await proxy(new NextRequest(new URL(r, 'http://localhost:3210')))
      expect(res.headers.get('location'), r).toBeNull()
    }
  })
})

describe('the privacy rules of every entity', () => {
  const FORBIDDEN = /(^|_)(title|description|body|comment|comments|remarks?|reason|email|emails|phone|mobile|whatsapp|password|token|form_data|snapshot|metadata|employee_id)(_|$)/
  const ctx: Ctx = { storeOfProfile: new Map(), storeCode: new Map() }

  it('has unique, well-formed names, and every returned column is described', () => {
    expect(new Set(ENTITIES.map((e) => e.name)).size).toBe(ENTITIES.length)
    for (const e of ENTITIES) {
      expect(e.name).toMatch(/^[a-z_]+$/)
      expect(e.columns.length).toBeGreaterThan(2)
      expect(e.columns.some((c) => c.name === 'id')).toBe(true)
      expect(e.mode === 'snapshot' ? e.cursor === 'id' : e.select.includes(e.cursor)).toBe(true)
    }
  })
  it('only the users entity carries a person\'s name', () => {
    expect(ENTITIES.filter((e) => e.columns.some((col) => col.pii === 'name')).map((e) => e.name)).toEqual(['users'])
    for (const e of ENTITIES.filter((x) => x.name !== 'users')) expect(e.columns.map((col) => col.name).filter((n) => /(full|display|person|user|requester|assignee)_?name/.test(n)), e.name).toEqual([])
  })
  it('never returns a column that can hold a contact detail or typed free text', () => {
    for (const e of ENTITIES) for (const col of e.columns) expect(`${e.name}.${col.name}`, 'column name').not.toMatch(FORBIDDEN)
  })
  it('returns exactly the described columns, whatever else the row holds', () => {
    for (const e of ENTITIES) {
      const row: Record<string, unknown> = {}
      for (const s of e.select) row[s] = s.endsWith('_at') ? '2026-11-02T04:00:00+00:00' : s === 'metadata' ? { from: 'open', to: 'closed', note: 'secret text' } : s === 'body' ? 'private words' : s === 'external_email' ? 'a@b.test' : 'v'
      // columns that must never reach the output even if a caller added them to the row
      Object.assign(row, { title: 'T', description: 'D', full_name: 'NAME-SENTINEL', email: 'e@x.test', mobile: '9', form_data: { a: 1 }, comment: 'C', cancellation_reason: 'R' })
      const out = e.map(row, ctx)
      expect(Object.keys(out).sort(), e.name).toEqual(e.columns.map((c) => c.name).sort())
      expect(JSON.stringify(out), e.name).not.toMatch(/private words|a@b\.test|secret text|e@x\.test/)
      if (e.name === 'users') expect(out.full_name).toBe('NAME-SENTINEL')
      else expect(JSON.stringify(out), e.name).not.toContain('NAME-SENTINEL')
    }
  })
  it('a ticket carries the store code of its requester and whether its SLA was missed', () => {
    const req = entityByName('requests')!
    const c: Ctx = { storeOfProfile: new Map([['u1', 'RBL']]), storeCode: new Map() }
    const out = req.map({ id: 'r1', requester_id: 'u1', responded_at: '2026-11-02T10:00:00+00:00', response_due_at: '2026-11-02T09:00:00+00:00', resolved_at: '2026-11-02T10:00:00+00:00', resolution_due_at: '2026-11-03T10:00:00+00:00' }, c)
    expect(out.store_code).toBe('RBL')
    expect(out.response_breached).toBe(true)
    expect(out.resolution_breached).toBe(false)
    expect(req.map({ id: 'r2', requester_id: 'none' }, c)).toMatchObject({ store_code: null, response_breached: null, resolution_breached: null })
  })
  it('a status change shows from -> to only; a comment shows its length only', () => {
    expect(entityByName('request_status_history')!.map({ id: 'a', request_id: 'r', actor_id: 'u', created_at: '2026-11-02T04:00:00+00:00', metadata: { from: 'open', to: 'in_progress', reason: 'x' } }, ctx))
      .toEqual({ id: 'a', request_id: 'r', actor_id: 'u', created_at: '2026-11-02T04:00:00Z', from_status: 'open', to_status: 'in_progress' })
    expect(entityByName('request_comments')!.map({ id: 'c', request_id: 'r', author_id: null, is_internal: false, source: 'web', created_at: '2026-11-02T04:00:00+00:00', body: 'hello', external_email: 'x@y.test' }, ctx))
      .toMatchObject({ text_length: 5, from_external: true, author_id: null })
  })
})
