// Audit D-061 / D-062: the WhatsApp webhook refuses an oversized body and a caller that floods it (before any database work), refuses a payload
// that mixes phone numbers, and does not let an unauthenticated flood become a flood of audit rows. (Unknown or wrongly signed requests are still
// recognised and audited, as before; see the stage5/6/7b integration tests.)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const touched = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { touched(); throw new Error('the database must not be touched for this request') } }))
const limiter = vi.fn(async () => ({ limited: false, remaining: 1 }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => limiter(...(a as [])), getClientIp: async () => '203.0.113.9' }))

import { POST, MAX_REQUESTS_PER_MINUTE_PER_CALLER } from '@/app/api/intake/webhook/whatsapp/route'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'

const payload = (...phoneIds: string[]) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: phoneIds.map((p, i) => ({ id: String(i), changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: p }, messages: [] } }] })),
})
const post = (body: string, headers: Record<string, string> = {}) => POST(new NextRequest('http://localhost/api/intake/webhook/whatsapp', { method: 'POST', body, headers }))

beforeEach(() => { touched.mockClear(); limiter.mockClear(); limiter.mockResolvedValue({ limited: false, remaining: 1 }) })

describe('webhook route', () => {
  it('refuses a body larger than 1 MB without reading the database', async () => {
    const res = await post('x'.repeat(1_048_577))
    expect(res.status).toBe(413)
    expect(touched).not.toHaveBeenCalled()
  })
  it('refuses a caller above the per-minute limit with 429 and no database work', async () => {
    limiter.mockResolvedValue({ limited: true, remaining: 0 })
    const res = await post(payload('111'))
    expect(res.status).toBe(429)
    expect(touched).not.toHaveBeenCalled()
    expect(limiter).toHaveBeenCalledWith('wa-webhook:203.0.113.9', MAX_REQUESTS_PER_MINUTE_PER_CALLER, 60_000)
  })
})

describe('webhook handler', () => {
  it('a payload that mixes phone numbers is refused before any lookup', async () => {
    const admin = { from: () => { throw new Error('no DB') }, rpc: () => { throw new Error('no DB') }, storage: {} } as never
    const r = await processWhatsAppWebhookPayload({ admin, rawBody: payload('111', '222'), signatureHeader: 'sha256=' + 'a'.repeat(64) })
    expect(r.outcome).toEqual({ kind: 'unsupported' })
  })
  it('malformed JSON is still reported as unsupported (unchanged)', async () => {
    const admin = { from: () => { throw new Error('no DB') }, rpc: () => { throw new Error('no DB') }, storage: {} } as never
    expect((await processWhatsAppWebhookPayload({ admin, rawBody: '{nope', signatureHeader: null })).outcome).toEqual({ kind: 'unsupported' })
  })
})
