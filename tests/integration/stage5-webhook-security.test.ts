/**
 * Stage 5, Step 32 — webhook security tests (AC-5.1/5.2/5.3/5.5).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import { setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, createMockGraphFetch, type WhatsAppChannelFixture } from '../setup/whatsapp-fixtures'
import type { FormField } from '@/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'
import { verifyWebhookChallenge } from '@/lib/whatsapp/config'
import { findActiveConversation } from '@/lib/conversations'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage5-sec-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]

describe('Stage 5 — webhook security', () => {
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  let requester: TestUser
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    requester = await createTestUser('stage5-sec-requester', 'Stage5 Security Requester')
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: '9666700001' })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await wa.cleanup()
    await fx.cleanup()
  }, 60_000)

  it('GET verification: an invalid verify_token is rejected (never echoes the challenge)', async () => {
    const verified = await verifyWebhookChallenge(admin as never, 'subscribe', 'totally-wrong-token')
    expect(verified).toBe(false)
  })

  it('GET verification: hub.mode other than "subscribe" is rejected even with a correct token', async () => {
    const verified = await verifyWebhookChallenge(admin as never, 'unsubscribe', wa.verifyToken)
    expect(verified).toBe(false)
  })

  it('GET verification: the correct token for an active channel is accepted', async () => {
    const verified = await verifyWebhookChallenge(admin as never, 'subscribe', wa.verifyToken)
    expect(verified).toBe(true)
  })

  it('POST: an invalid signature is rejected and NO conversation is created', async () => {
    const mock = createMockGraphFetch()
    const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919666700001', body: 'Hi', runTag: RUN_TAG })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: 'sha256=deadbeef', fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'invalid_signature' })

    const active = await findActiveConversation({ admin: admin as never, orgId: fx.orgId, channelType: 'whatsapp', channelIdentity: '919666700001' })
    expect(active).toBeNull()
  })

  it('POST: a missing signature header is rejected', async () => {
    const mock = createMockGraphFetch()
    const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919666700002', body: 'Hi', runTag: RUN_TAG })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: null, fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'invalid_signature' })
  })

  it('POST: an unknown phone_number_id is not processed (no channel guessed, no crash)', async () => {
    const mock = createMockGraphFetch()
    const rawBody = buildTextMessagePayload({ phoneNumberId: 'no-such-phone-number-id', from: '919666700003', body: 'Hi', runTag: RUN_TAG })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: 'sha256=irrelevant', fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'channel_not_found' })
  })

  it('POST: an unparseable payload is handled safely, never throws', async () => {
    const mock = createMockGraphFetch()
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody: '{ this is not valid json', signatureHeader: 'sha256=whatever', fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'unsupported' })
  })

  it('POST: a well-formed-but-schema-invalid payload (missing phone_number_id) is handled safely', async () => {
    const mock = createMockGraphFetch()
    const rawBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'x', changes: [{ field: 'messages', value: { metadata: {} } }] }] })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: 'sha256=whatever', fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'unsupported' })
  })

  it('POST: an unregistered sender never enters the conversation engine and gets a safe generic message', async () => {
    const mock = createMockGraphFetch()
    const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919000000000', body: 'Hi', runTag: RUN_TAG })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'rejected_sender', reason: 'not_registered' })

    const active = await findActiveConversation({ admin: admin as never, orgId: fx.orgId, channelType: 'whatsapp', channelIdentity: '919000000000' })
    expect(active).toBeNull()

    const sendCalls = mock.calls.filter((c) => c.url.includes('/messages') && c.init?.method === 'POST')
    expect(sendCalls.length).toBe(1)
    const body = JSON.parse(sendCalls[0].init!.body as string)
    expect(body.text.body.toLowerCase()).toContain('not registered')
    // Never reveals whether the number belongs to someone else or another org.
    expect(body.text.body.toLowerCase()).not.toContain('org')
  })

  it('POST: an inactive requester never enters the conversation engine', async () => {
    const inactive = await createTestUser('stage5-sec-inactive', 'Stage5 Inactive')
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: false }).eq('id', inactive.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: inactive.id, org_id: fx.orgId, mobile_number: '9666700004' })
    try {
      const mock = createMockGraphFetch()
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919666700004', body: 'Hi', runTag: RUN_TAG })
      const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
      expect(result.outcome).toEqual({ kind: 'rejected_sender', reason: 'inactive' })
    } finally {
      await admin.auth.admin.deleteUser(inactive.id)
    }
  })

  it('POST: a requester with whatsapp_enabled=false never enters the conversation engine', async () => {
    const disabled = await createTestUser('stage5-sec-disabled', 'Stage5 Disabled')
    await admin.from('profiles').update({ whatsapp_enabled: false, is_active: true }).eq('id', disabled.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: disabled.id, org_id: fx.orgId, mobile_number: '9666700005' })
    try {
      const mock = createMockGraphFetch()
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919666700005', body: 'Hi', runTag: RUN_TAG })
      const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
      expect(result.outcome).toEqual({ kind: 'rejected_sender', reason: 'whatsapp_disabled' })
    } finally {
      await admin.auth.admin.deleteUser(disabled.id)
    }
  })

  it('POST: an unsupported message type (sticker) does not crash and does not start a conversation', async () => {
    const mock = createMockGraphFetch()
    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: wa.phoneNumberId },
        messages: [{ from: '919666700001', id: `${RUN_TAG}-sticker`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'sticker' }],
      } }] }],
    })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'unsupported' })
  })

  it('POST: a status-only payload (delivery receipt) is recorded but never starts a conversation', async () => {
    const mock = createMockGraphFetch()
    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: wa.phoneNumberId },
        statuses: [{ id: `${RUN_TAG}-status`, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '919666700001' }],
      } }] }],
    })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toEqual({ kind: 'status_event' })
    const active = await findActiveConversation({ admin: admin as never, orgId: fx.orgId, channelType: 'whatsapp', channelIdentity: '919666700001' })
    expect(active).toBeNull()
  })
})
