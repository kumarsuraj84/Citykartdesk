import http from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  access: null as unknown,
  roles: ['requester'] as string[],
  audit: [] as unknown[],
}))

vi.mock('@/lib/ckoneai/access', () => ({ assistantAccess: async () => state.access }))
vi.mock('@/lib/ckoneai/roles', () => ({ computeRoles: async () => state.roles }))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: async (e: unknown) => { state.audit.push(e) } }))

import { forwardToCkoneai } from '@/lib/ckoneai/forward'
import { sha256Hex, sign } from '@/lib/ckoneai/sign'

const SECRET = 's'.repeat(48)
const USER = '11111111-2222-4333-8444-555555555555'

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer; at: number }
let seen: Seen[] = []
let behaviour: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void = (_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') }
let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body, at: Date.now() })
      behaviour(req, res, body)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

beforeEach(() => {
  seen = []
  state.audit = []
  state.roles = ['requester']
  state.access = { ok: true, cfg: { on: true, baseUrl: base, secret: SECRET, pilot: '*' }, profile: { id: USER, org_id: 'org-1', role: 'user' } }
  behaviour = (_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') }
})

const call = (path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}) =>
  forwardToCkoneai(new NextRequest(`http://app.local${path}`, { method: init.method ?? 'GET', body: init.body, headers: init.headers }))

describe('forwarding to CKOneAI', () => {
  it('signs exactly what it sends, with the person, roles and whole-second stamp', async () => {
    state.roles = ['requester', 'technician']
    const res = await call('/api/ckoneai/conversations?z=1&a=2', { headers: { accept: 'application/json' } })
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(1)
    const s = seen[0]
    expect(s.url).toBe('/api/ckoneai/conversations?z=1&a=2')
    const h = s.headers
    expect(h['x-ckdesk-user']).toBe(USER)
    expect(h['x-ckdesk-roles']).toBe('requester,technician')
    expect(h['x-ckdesk-scope']).toBe('ckdesk')
    expect(h['x-ckdesk-nonce']).toMatch(/^[0-9a-f]{16}$/)
    expect(Math.abs(Number(h['x-ckdesk-ts']) - Date.now() / 1000)).toBeLessThan(5)
    const again = sign({ secret: SECRET, method: s.method, target: s.url, userId: String(h['x-ckdesk-user']), roles: String(h['x-ckdesk-roles']).split(','), ts: Number(h['x-ckdesk-ts']), nonce: String(h['x-ckdesk-nonce']), body: s.body })
    expect(h['x-ckdesk-sig']).toBe(again)
    expect(s.body.length).toBe(0)
  })

  it('sends the raw body bytes untouched and signs their hash (odd spacing, non-ASCII)', async () => {
    const raw = Buffer.from('{ "message" :"मेरे pending approvals दिखाओ – café" ,\n"x":1 }', 'utf8')
    const res = await call('/api/ckoneai/chat', { method: 'POST', body: raw, headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(200)
    const s = seen[0]
    expect(Buffer.compare(s.body, raw)).toBe(0)
    expect(s.headers['content-type']).toBe('application/json')
    const again = sign({ secret: SECRET, method: 'POST', target: '/api/ckoneai/chat', userId: USER, roles: ['requester'], ts: Number(s.headers['x-ckdesk-ts']), nonce: String(s.headers['x-ckdesk-nonce']), body: raw })
    expect(s.headers['x-ckdesk-sig']).toBe(again)
    expect(sha256Hex(s.body)).toBe(sha256Hex(raw))
  })

  it('a new nonce on every call, and the roles are recomputed each time', async () => {
    await call('/api/ckoneai/capabilities')
    state.roles = ['approver', 'requester']
    await call('/api/ckoneai/capabilities')
    expect(seen[0].headers['x-ckdesk-nonce']).not.toBe(seen[1].headers['x-ckdesk-nonce'])
    expect(seen[0].headers['x-ckdesk-roles']).toBe('requester')
    expect(seen[1].headers['x-ckdesk-roles']).toBe('approver,requester')
  })

  it('drops everything the browser sent that could speak for the person', async () => {
    await call('/api/ckoneai/capabilities', {
      headers: {
        'x-ckdesk-user': 'attacker', 'x-ckdesk-roles': 'approver,technician', 'x-ckdesk-scope': 'other', 'x-ckdesk-sig': 'ff', 'X-CKDESK-Nonce': 'bad',
        authorization: 'Bearer abc', cookie: 'sb-session=SECRET-SESSION', 'x-forwarded-for': '1.2.3.4', 'x-request-id': 'req-9',
      },
    })
    const h = seen[0].headers
    expect(h['x-ckdesk-user']).toBe(USER)
    expect(h['x-ckdesk-roles']).toBe('requester')
    expect(h['x-ckdesk-scope']).toBe('ckdesk')
    expect(h['x-ckdesk-nonce']).not.toBe('bad')
    expect(h.authorization).toBeUndefined()
    expect(h.cookie).toBeUndefined()
    expect(h['x-forwarded-for']).toBeUndefined()
    expect(h['x-request-id']).toBe('req-9')
    expect(JSON.stringify(h)).not.toContain('SECRET-SESSION')
    expect(JSON.stringify(h)).not.toContain(SECRET)
  })

  it('does not ask for compressed answers (so they can stream)', async () => {
    await call('/api/ckoneai/capabilities', { headers: { 'accept-encoding': 'gzip' } })
    expect(seen[0].headers['accept-encoding']).toBe('identity')
  })

  it('refuses before calling CKOneAI: switched off, not signed in, vendor, not on the pilot', async () => {
    for (const [status, error] of [[503, 'off'], [401, 'in'], [403, 'vendor'], [403, 'pilot']] as const) {
      state.access = { ok: false, status, error }
      const res = await call('/api/ckoneai/chat', { method: 'POST', body: '{}' })
      expect(res.status).toBe(status)
    }
    expect(seen).toHaveLength(0)
  })

  it('refuses bad addresses and methods before anything else', async () => {
    for (const p of ['/api/ckoneai/../x', '/api/ckoneai/a%2Fb', '/api/other', '/ckoneai-ui/.env']) {
      const res = await call(p)
      expect(res.status, p).toBe(400)
    }
    expect((await call('/api/ckoneai/chat', { method: 'POST', body: '{}' })).status).toBe(200)
    expect((await call('/ckoneai-ui/', { method: 'POST', body: '{}' })).status).toBe(405)
    expect(seen).toHaveLength(1)
  })

  it('refuses a message that is too large without sending it on', async () => {
    const res = await call('/api/ckoneai/chat', { method: 'POST', body: Buffer.alloc(300 * 1024, 97) })
    expect(res.status).toBe(413)
    expect(seen).toHaveLength(0)
  })

  it('a stranger who answers with a redirect or sets cookies gets neither passed on', async () => {
    behaviour = (_q, res) => { res.writeHead(302, { location: 'http://evil.example/', 'set-cookie': 'a=b' }); res.end() }
    const r1 = await call('/api/ckoneai/capabilities')
    expect(r1.status).toBe(502)
    expect(r1.headers.get('location')).toBeNull()
    behaviour = (_q, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'sid=1', 'x-powered-by': 'x', server: 'uvicorn' }); res.end('hi') }
    const r2 = await call('/api/ckoneai/capabilities')
    expect(r2.headers.get('set-cookie')).toBeNull()
    expect(r2.headers.get('server')).toBeNull()
    expect(r2.headers.get('cache-control')).toBe('no-store, no-transform')
    expect(r2.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await r2.text()).toBe('hi')
  })

  it('passes the status and body of an error from CKOneAI', async () => {
    behaviour = (_q, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"detail":"Not authorised"}') }
    const res = await call('/api/ckoneai/chat', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ detail: 'Not authorised' })
  })

  it('answers 502 and logs a warning when CKOneAI does not answer', async () => {
    state.access = { ok: true, cfg: { on: true, baseUrl: 'http://127.0.0.1:9', secret: SECRET, pilot: '*' }, profile: { id: USER, org_id: 'org-1', role: 'user' } }
    const res = await call('/api/ckoneai/capabilities')
    expect(res.status).toBe(502)
    expect(state.audit).toMatchObject([{ action: 'ckoneai.unreachable', outcome: 'failure' }])
  })

  it('when the chat page cannot be reached the frame shows a plain sentence (HTML), not JSON', async () => {
    state.access = { ok: true, cfg: { on: true, baseUrl: 'http://127.0.0.1:9', secret: SECRET, pilot: '*' }, profile: { id: USER, org_id: 'org-1', role: 'user' } }
    const res = await call('/ckoneai-ui?embed=1&bridge=ckdesk')
    expect(res.status).toBe(502)
    expect(res.headers.get('content-type')).toContain('text/html')
    const text = await res.text()
    expect(text).toContain('did not answer')
    expect(text).toContain('not affected')
    expect(text).not.toContain('{')
  })

  it('streams an answer as it is produced', async () => {
    behaviour = (_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: one\n\n')
      setTimeout(() => res.write('data: two\n\n'), 300)
      setTimeout(() => res.end('data: three\n\n'), 600)
    }
    const t0 = Date.now()
    const res = await call('/api/ckoneai/chat', { method: 'POST', body: '{"message":"hello"}' })
    const reader = res.body!.getReader()
    const first = await reader.read()
    const firstAt = Date.now() - t0
    expect(new TextDecoder().decode(first.value)).toContain('one')
    expect(firstAt).toBeLessThan(250)                 // the first part arrives before the answer is finished
    let rest = ''
    for (;;) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value) }
    expect(rest).toContain('three')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550)
  })

  it('a connection cut in the middle of an answer ends that answer with an error and nothing else breaks', async () => {
    behaviour = (_q, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); setTimeout(() => res.destroy(), 100) }
    const res = await call('/api/ckoneai/chat', { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('first')
    await expect((async () => { for (;;) { const { done } = await reader.read(); if (done) return 'ended' } })()).rejects.toBeTruthy()
    // the next call is served normally
    behaviour = (_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') }
    expect((await call('/api/ckoneai/capabilities')).status).toBe(200)
  })

  it('records who asked, never what', async () => {
    const secretQuestion = 'QUESTION-TEXT-THAT-MUST-NOT-BE-LOGGED'
    await call('/api/ckoneai/chat', { method: 'POST', body: JSON.stringify({ message: secretQuestion }) })
    await call('/api/ckoneai/capabilities')
    expect(state.audit).toHaveLength(1)
    expect(state.audit[0]).toMatchObject({ action: 'ckoneai.ask', actorId: USER, orgId: 'org-1' })
    expect(JSON.stringify(state.audit)).not.toContain(secretQuestion)
  })

  it('limits how many questions one person can ask in a minute', async () => {
    state.access = { ok: true, cfg: { on: true, baseUrl: base, secret: SECRET, pilot: '*' }, profile: { id: '99999999-0000-4000-8000-000000000001', org_id: 'org-1', role: 'user' } }
    let limited = 0
    for (let i = 0; i < 25; i++) { const r = await call('/api/ckoneai/chat', { method: 'POST', body: '{}' }); if (r.status === 429) limited++ }
    expect(limited).toBe(5)
    expect(seen).toHaveLength(20)
  })

  it('sends the chat page files to CKOneAI as /<x> (its root), signed with that upstream address', async () => {
    await call('/ckoneai-ui?embed=1&bridge=ckdesk')
    await call('/ckoneai-ui/assets/app-1.js')
    expect(seen.map((s) => s.url)).toEqual(['/?embed=1&bridge=ckdesk', '/assets/app-1.js'])
    const h = seen[0].headers
    const again = sign({ secret: SECRET, method: 'GET', target: '/?embed=1&bridge=ckdesk', userId: USER, roles: String(h['x-ckdesk-roles']).split(','), ts: Number(h['x-ckdesk-ts']), nonce: String(h['x-ckdesk-nonce']), body: new Uint8Array(0) })
    expect(h['x-ckdesk-sig']).toBe(again)
  })

  it('serves the chat page files with GET and HEAD only, and keeps the file cache header', async () => {
    behaviour = (_q, res) => { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable', etag: '"abc"' }); res.end('console.log(1)') }
    const res = await call('/ckoneai-ui/assets/app-1.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toBe('console.log(1)')
  })
})

// A long answer must not be cut: run once by hand with CKONEAI_LONG_TEST=1 (it takes about 2 minutes)
describe.skipIf(process.env.CKONEAI_LONG_TEST !== '1')('a long streamed answer', () => {
  it('is delivered whole after more than 120 seconds', async () => {
    behaviour = (_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      let n = 0
      const t = setInterval(() => { res.write(`data: ${++n}\n\n`); if (n === 13) { clearInterval(t); res.end('data: done\n\n') } }, 10_000)
    }
    const res = await call('/api/ckoneai/chat', { method: 'POST', body: '{"message":"slow"}' })
    const text = await res.text()
    expect(text).toContain('data: 13')
    expect(text).toContain('data: done')
  }, 200_000)
})

// Cost of the forwarding layer itself (signing, checks, the extra hop) against a stand-in that answers at once: run by hand with CKONEAI_BENCH=1, writes the numbers to the evidence folder.
describe.skipIf(process.env.CKONEAI_BENCH !== '1')('forwarding overhead', () => {
  it('measures the added time for one caller and for 20 at once', async () => {
    const { writeFileSync } = await import('node:fs')
    const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] }
    const direct = async () => { const t = performance.now(); const r = await fetch(base + '/api/ckoneai/capabilities'); await r.text(); return performance.now() - t }
    const viaCk = async (i: number) => { state.access = { ok: true, cfg: { on: true, baseUrl: base, secret: SECRET, pilot: '*' }, profile: { id: `00000000-0000-4000-8000-${String(i % 50).padStart(12, '0')}`, org_id: 'o', role: 'user' } }; const t = performance.now(); const r = await call('/api/ckoneai/capabilities'); await r.text(); return performance.now() - t }
    for (let i = 0; i < 20; i++) { await direct(); await viaCk(i) }   // warm up
    const d: number[] = [], v: number[] = []
    for (let i = 0; i < 300; i++) { d.push(await direct()); v.push(await viaCk(i)) }
    const conc: number[] = []
    for (let round = 0; round < 10; round++) { const t0 = performance.now(); await Promise.all(Array.from({ length: 20 }, (_, k) => viaCk(round * 20 + k).then((x) => conc.push(x)))); void t0 }
    const out = {
      note: 'forwarding layer only (stand-in answers at once, same PC); the real service adds its own time',
      sequential_300: { direct_ms: { p50: pct(d, 50), p95: pct(d, 95) }, via_ckdesk_ms: { p50: pct(v, 50), p95: pct(v, 95) }, added_p50_ms: pct(v, 50) - pct(d, 50), added_p95_ms: pct(v, 95) - pct(d, 95) },
      concurrent_20x10: { via_ckdesk_ms: { p50: pct(conc, 50), p95: pct(conc, 95) } },
    }
    writeFileSync(path.join(__dirname, '../../docs/ckoneai-desk/evidence/forwarding-overhead.json'), JSON.stringify(out, null, 1))
    expect(out.sequential_300.via_ckdesk_ms.p95).toBeLessThan(500)
  }, 120_000)
})
