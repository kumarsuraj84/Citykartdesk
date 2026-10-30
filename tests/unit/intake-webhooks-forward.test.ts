// G-07 / G-08 / G-09 / G-30: the Outlook and Gmail notification endpoints answer an error status when the worker is missing or the hand-over fails (so Microsoft /
// Google retry), take back the "seen" mark of a notification that did not get through, read the body with a hard size limit, and (Gmail) require Google's own
// signature once a Gmail channel exists.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeDb, type FakeDb } from './helpers/fake-db'

let db: FakeDb
const forgotten: string[] = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (t: string) => db.from(t),
    rpc: async (name: string, args: { p_key?: string }) => { if (name === 'webhook_seen_forget') forgotten.push(String(args.p_key)); return { data: null, error: null } },
  }),
}))
vi.mock('@/lib/secrets', () => ({ getSecret: (name: string) => (name === 'intake_webhook' ? 'hook-secret' : name === 'intake_worker' ? 'worker-secret' : null) }))
const seen = new Set<string>()
let limited = false
vi.mock('@/lib/security/shared-limits', () => ({
  firstDelivery: async (key: string) => { if (seen.has(key)) return false; seen.add(key); return true },
  sharedRateLimited: async () => limited,
}))
const oidc = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/intake/google-oidc', () => ({ verifyGoogleOidc: (...a: unknown[]) => (oidc as unknown as (...x: unknown[]) => unknown)(...a) }))
let workerAnswer: 'ok' | 'fail' | 'throw' = 'ok'
const workerCalls: string[] = []
vi.mock('@/lib/http/fetch-timeout', () => ({
  fetchWithTimeout: async (url: string) => {
    workerCalls.push(url)
    if (workerAnswer === 'throw') throw new Error('timeout')
    return { ok: workerAnswer === 'ok', status: workerAnswer === 'ok' ? 200 : 500 }
  },
}))

import { POST as outlookPost } from '@/app/api/intake/webhook/outlook/route'
import { POST as gmailPost } from '@/app/api/intake/webhook/gmail/route'
import { readCappedBody } from '@/lib/intake/webhook-forward'

const outlookBody = (id = 'msg-1') => JSON.stringify({ value: [{ changeType: 'created', resourceData: { id }, subscriptionId: 'sub-1', clientState: 'hook-secret' }] })
const outlookReq = (body: string) => new NextRequest('http://localhost/api/intake/webhook/outlook', { method: 'POST', body, headers: { 'content-type': 'application/json' } })
const pubsub = (messageId = 'p-1') => JSON.stringify({ message: { messageId, publishTime: new Date().toISOString(), data: Buffer.from(JSON.stringify({ emailAddress: 'desk@citykart.test', historyId: '77' })).toString('base64') } })
const gmailReq = (body: string) => new NextRequest('http://localhost/api/intake/webhook/gmail?token=hook-secret', { method: 'POST', body, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  seen.clear(); forgotten.length = 0; workerCalls.length = 0; workerAnswer = 'ok'; limited = false
  process.env.INTAKE_WORKER_URL = 'https://worker.test'
  delete process.env.GMAIL_PUSH_OIDC_AUDIENCE; delete process.env.GMAIL_PUSH_OIDC_EMAIL; delete process.env.GMAIL_PUSH_ALLOW_TOKEN_ONLY
  oidc.mockClear()
  db = fakeDb({ intake_channels: [
    { id: 'ch-o', type: 'email', provider: 'm365', status: 'active', config: { graph_subscription_id: 'sub-1' } },
    { id: 'ch-g', type: 'email', provider: 'gmail', status: 'active', config: { user: 'desk@citykart.test' } },
  ] })
  // the fake reads a nested config key only for "a->>b"; the routes use filter('config->>x', 'eq', v)
})

describe('Outlook notifications', () => {
  it('hands the notification to the worker and answers 200', async () => {
    const res = await outlookPost(outlookReq(outlookBody()))
    expect(res.status).toBe(200)
    expect(workerCalls).toEqual(['https://worker.test/intake/graph-sync'])
  })

  it('when the worker call fails: 503 (Microsoft retries) and the seen-mark is taken back so the retry is not dropped as a repeat', async () => {
    workerAnswer = 'fail'
    const res = await outlookPost(outlookReq(outlookBody()))
    expect(res.status).toBe(503)
    expect(forgotten).toEqual(['outlook:sub-1:msg-1'])
    workerAnswer = 'ok'
    seen.clear()   // what the real guard does once the mark is forgotten
    expect((await outlookPost(outlookReq(outlookBody()))).status).toBe(200)
  })

  it('a timeout is treated the same way', async () => {
    workerAnswer = 'throw'
    expect((await outlookPost(outlookReq(outlookBody()))).status).toBe(503)
  })

  it('with no worker configured: 503, not 200', async () => {
    delete process.env.INTAKE_WORKER_URL
    expect((await outlookPost(outlookReq(outlookBody()))).status).toBe(503)
  })

  it('a repeat of a notification that DID go through is not forwarded twice', async () => {
    await outlookPost(outlookReq(outlookBody()))
    await outlookPost(outlookReq(outlookBody()))
    expect(workerCalls).toHaveLength(1)
  })

  it('a wrong clientState is ignored (never forwarded)', async () => {
    const body = JSON.stringify({ value: [{ changeType: 'created', resourceData: { id: 'm' }, subscriptionId: 'sub-1', clientState: 'wrong' }] })
    expect((await outlookPost(outlookReq(body))).status).toBe(200)
    expect(workerCalls).toHaveLength(0)
  })

  it('refuses a body over the limit while reading it, even without a Content-Length', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(200_000))
    const stream = new ReadableStream({ start(c) { c.enqueue(chunk); c.enqueue(chunk); c.close() } })
    const res = await outlookPost(new NextRequest('http://localhost/api/intake/webhook/outlook', { method: 'POST', body: stream, duplex: 'half' } as never))
    expect(res.status).toBe(413)
    expect(workerCalls).toHaveLength(0)
  })

  it('answers 429 over the shared limit (before the body is read)', async () => {
    limited = true
    expect((await outlookPost(outlookReq(outlookBody()))).status).toBe(429)
  })
})

describe('Gmail push notifications', () => {
  it('with Google\'s signature configured it hands the notification to the worker', async () => {
    process.env.GMAIL_PUSH_OIDC_AUDIENCE = 'aud'; process.env.GMAIL_PUSH_OIDC_EMAIL = 'push@x.test'
    const res = await gmailPost(gmailReq(pubsub()))
    expect(res.status).toBe(200)
    expect(oidc).toHaveBeenCalled()
    expect(workerCalls).toEqual(['https://worker.test/intake/gmail-sync'])
  })

  it('once a Gmail channel exists and Google\'s signature is not configured: 503 and nothing is forwarded', async () => {
    const res = await gmailPost(gmailReq(pubsub()))
    expect(res.status).toBe(503)
    expect(workerCalls).toHaveLength(0)
  })

  it('GMAIL_PUSH_ALLOW_TOKEN_ONLY=true keeps the shared token enough, explicitly', async () => {
    process.env.GMAIL_PUSH_ALLOW_TOKEN_ONLY = 'true'
    expect((await gmailPost(gmailReq(pubsub()))).status).toBe(200)
  })

  it('with no Gmail channel at all there is nothing to protect yet', async () => {
    db = fakeDb({ intake_channels: [] })
    expect((await gmailPost(gmailReq(pubsub()))).status).toBe(200)
  })

  it('a failed signature check is 401', async () => {
    process.env.GMAIL_PUSH_OIDC_AUDIENCE = 'aud'; process.env.GMAIL_PUSH_OIDC_EMAIL = 'push@x.test'
    oidc.mockResolvedValueOnce({ ok: false })
    expect((await gmailPost(gmailReq(pubsub()))).status).toBe(401)
  })

  it('a failed hand-over is 503 and the Pub/Sub message can be retried', async () => {
    process.env.GMAIL_PUSH_OIDC_AUDIENCE = 'aud'; process.env.GMAIL_PUSH_OIDC_EMAIL = 'push@x.test'
    workerAnswer = 'fail'
    expect((await gmailPost(gmailReq(pubsub('p-9')))).status).toBe(503)
    expect(forgotten).toEqual(['gmail:p-9'])
  })

  it('with no worker configured: 503', async () => {
    process.env.GMAIL_PUSH_OIDC_AUDIENCE = 'aud'; process.env.GMAIL_PUSH_OIDC_EMAIL = 'push@x.test'
    delete process.env.INTAKE_WORKER_URL
    expect((await gmailPost(gmailReq(pubsub()))).status).toBe(503)
  })

  it('a wrong URL token is 401', async () => {
    const bad = new NextRequest('http://localhost/api/intake/webhook/gmail?token=nope', { method: 'POST', body: pubsub() })
    expect((await gmailPost(bad)).status).toBe(401)
  })
})

describe('readCappedBody', () => {
  it('returns the text of a body within the limit and refuses one over it', async () => {
    expect(await readCappedBody(new Request('http://x.test', { method: 'POST', body: 'hello' }), 100)).toEqual({ ok: true, text: 'hello' })
    expect(await readCappedBody(new Request('http://x.test', { method: 'POST', body: 'x'.repeat(101) }), 100)).toEqual({ ok: false })
  })
})
