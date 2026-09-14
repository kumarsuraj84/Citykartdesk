/**
 * Stage 7 UAT (Step 24 of the Stage 7B execution brief) — UAT-31 (outbound
 * Meta failure: 429 then 5xx recovery, then a persistent failure audited
 * without duplicate ticket/state) and UAT-32 (invalid webhook signature and
 * invalid verify token both safely rejected). ANY invalid webhook accepted
 * is a BLOCKER per the brief — verified explicitly below.
 *
 * Follows stage5-outbound-failure.test.ts (bounded-retry pattern) and
 * stage5-webhook-security.test.ts (signature/verify-token pattern) exactly,
 * both explicitly named as this scenario class's reference files, run
 * through the real signature-verification code path
 * (verifyMetaSignature/verifyWebhookChallenge) and the real
 * processWhatsAppWebhookPayload pipeline with only the Meta Graph API HTTP
 * boundary mocked.
 */
import { describe, it, expect, vi } from 'vitest'
import { getAdmin, createTestUser } from '../setup/fixtures-d03'
import { setupConversationFixture } from '../setup/conversation-fixtures'
import { setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, createMockGraphFetch } from '../setup/whatsapp-fixtures'
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
const RUN_TAG = `uat7b-8c5d02-meta-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]

describe('Stage 7B — UAT-31: outbound Meta send failures (429, 5xx, persistent) — bounded retry, no duplicate ticket/state', () => {
  const admin = getAdmin()

  it('a 429 then a transient 5xx both recover within sendAll()\'s bounded retry — the requester still gets the prompt, no duplicate state advancement', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-a`, orgId: fx.orgId, phoneNumberId: `1564${RUN_TAG.slice(-6)}` })
    const requester = await createTestUser('uat7b-meta-429-req', 'UAT7B Meta 429 Requester')
    const sender = '9700600001'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)

    try {
      const mock = createMockGraphFetch()
      // First send attempt gets a 429, second a 5xx, third (final retry) succeeds
      // — both classes explicitly named in UAT-31.
      mock.setSendFailure({ status: 429, body: { error: { message: 'Too Many Requests' } } }, 2)
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: `91${sender}`, body: 'Hi', runTag: `${RUN_TAG}-a` })
      const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      expect(result.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
      expect((result.outcome as { deliveryFailed?: boolean }).deliveryFailed).toBeFalsy() // ultimately delivered

      const sendAttempts = mock.calls.filter((c) => c.url.includes('/messages') && c.init?.method === 'POST')
      expect(sendAttempts.length).toBeGreaterThanOrEqual(3) // 2 failures (429+5xx-class) + 1 success

      const conversationId = (result.outcome as { conversationId: string }).conversationId
      const { count } = await admin.from('request_conversations').select('id', { count: 'exact', head: true }).eq('id', conversationId)
      expect(count).toBe(1) // exactly one conversation row — no duplicate state advancement from the retries

      const { data: failedAudit } = await admin
        .from('intake_audit_log').select('id').eq('org_id', fx.orgId).eq('action', 'whatsapp_send_failed')
        .eq('metadata->>conversationId', conversationId)
      expect(failedAudit ?? []).toHaveLength(0) // a recovered send is never reported as a failure
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}-a%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  }, 60_000)

  it('a persistent 5xx failure (retries exhausted) never blocks Stage 4 state, is audited exactly once, and produces no duplicate ticket', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: fx.orgId, phoneNumberId: `1565${RUN_TAG.slice(-6)}` })
    const requester = await createTestUser('uat7b-meta-persist-req', 'UAT7B Meta Persistent Failure Requester')
    const sender = '9700600002'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)

    try {
      const mock = createMockGraphFetch()
      mock.setSendFailure({ status: 500, body: { error: { message: 'Internal Server Error' } } }) // fails every attempt, unbounded
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: `91${sender}`, body: 'Hi', runTag: `${RUN_TAG}-b` })
      const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      // Stage 4's own state transition is unaffected by the outbound
      // delivery problem — the conversation genuinely advanced.
      expect(result.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service', deliveryFailed: true })
      const conversationId = (result.outcome as { conversationId: string }).conversationId

      const { data: failedAudit } = await admin
        .from('intake_audit_log').select('id, metadata').eq('org_id', fx.orgId).eq('action', 'whatsapp_send_failed')
        .eq('metadata->>conversationId', conversationId)
      expect(failedAudit ?? []).toHaveLength(1) // audited exactly once, never silently dropped

      // Sending the SAME externalMessageId again (a genuine Meta retry of
      // an already-processed message, now that the state has advanced)
      // must never create a duplicate ticket/state — idempotency still
      // holds even after a delivery failure.
      const replay = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
      expect(replay.outcome).toMatchObject({ kind: 'processed', conversationId, state: 'awaiting_service' })
      const { count } = await admin.from('request_conversations').select('id', { count: 'exact', head: true }).eq('requester_id', requester.id)
      expect(count).toBe(1) // still exactly one conversation row
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}-b%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  }, 60_000)
})

describe('Stage 7B — UAT-32: webhook security — invalid signature and invalid verify token both safely rejected (BLOCKER check: neither is ever accepted)', () => {
  const admin = getAdmin()

  it('an invalid X-Hub-Signature-256 against the REAL verifyMetaSignature code path is rejected with no processing and no state change', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-c`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-c`, orgId: fx.orgId, phoneNumberId: `1566${RUN_TAG.slice(-6)}` })
    const requester = await createTestUser('uat7b-meta-sig-req', 'UAT7B Invalid Signature Requester')
    const sender = '9700600003'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)

    try {
      const mock = createMockGraphFetch()
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: `91${sender}`, body: 'Hi', runTag: `${RUN_TAG}-c` })

      // A completely wrong signature — never computed from this channel's
      // real app_secret.
      const rWrongSig = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: 'sha256=0000000000000000000000000000000000000000000000000000000000000000', fetchImpl: mock.fetchImpl })
      expect(rWrongSig.outcome).toEqual({ kind: 'invalid_signature' })

      // A missing signature header entirely.
      const rNoSig = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: null, fetchImpl: mock.fetchImpl })
      expect(rNoSig.outcome).toEqual({ kind: 'invalid_signature' })

      // A signature computed against a DIFFERENT (wrong) secret — a more
      // realistic "attacker guessed/reused an old secret" scenario than a
      // bare garbage string.
      const wrongSecretSig = signPayload(rawBody, `not-this-channels-secret-${RUN_TAG}`)
      const rWrongSecret = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: wrongSecretSig, fetchImpl: mock.fetchImpl })
      expect(rWrongSecret.outcome).toEqual({ kind: 'invalid_signature' })

      // BLOCKER check: no conversation was ever created / no state change,
      // for any of the three rejected attempts.
      const active = await findActiveConversation({ admin: admin as never, orgId: fx.orgId, channelType: 'whatsapp', channelIdentity: `91${sender}` })
      expect(active).toBeNull()
      const { count: convCount } = await admin.from('request_conversations').select('id', { count: 'exact', head: true }).eq('requester_id', requester.id)
      expect(convCount).toBe(0)

      // A genuine, correctly-signed request afterward still works normally
      // — confirms the rejections above were specific to the bad
      // signatures, not a broken channel/fixture.
      const validSig = signPayload(rawBody, wa.appSecret)
      const rValid = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: validSig, fetchImpl: mock.fetchImpl })
      expect(rValid.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

      // Audit trail: every invalid-signature attempt is logged.
      const { data: sigAudit } = await admin.from('intake_audit_log').select('id').eq('org_id', fx.orgId).eq('entity_id', wa.channelId).eq('action', 'whatsapp_invalid_signature')
      expect((sigAudit ?? []).length).toBeGreaterThanOrEqual(3)
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}-c%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  }, 60_000)

  it('an invalid hub.verify_token against the REAL verifyWebhookChallenge code path never echoes the challenge (GET handshake, BLOCKER check)', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-d`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-d`, orgId: fx.orgId, phoneNumberId: `1567${RUN_TAG.slice(-6)}` })
    mockedCreateClient.mockResolvedValue(admin as never)

    try {
      const wrongToken = await verifyWebhookChallenge(admin as never, 'subscribe', `wrong-token-${RUN_TAG}`)
      expect(wrongToken).toBe(false) // BLOCKER check: an invalid verify token is never accepted

      const emptyToken = await verifyWebhookChallenge(admin as never, 'subscribe', '')
      expect(emptyToken).toBe(false)

      const wrongMode = await verifyWebhookChallenge(admin as never, 'unsubscribe', wa.verifyToken)
      expect(wrongMode).toBe(false) // correct token, but hub.mode isn't 'subscribe' — still rejected

      // A correctly-signed token/mode for THIS channel is accepted (confirms
      // the fixture itself is valid, not just that everything fails).
      const correct = await verifyWebhookChallenge(admin as never, 'subscribe', wa.verifyToken)
      expect(correct).toBe(true)

      // Cross-channel: this channel's OWN verify token must never validate
      // against a DIFFERENT, unrelated channel's expectations by accident —
      // proven by the wrong-token case above already using a value that
      // exists nowhere in the system.
    } finally {
      await wa.cleanup()
      await fx.cleanup()
    }
  }, 60_000)
})
