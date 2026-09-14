/**
 * Stage 6, Part 22 — proves all 9 WhatsApp audit-log event types a real
 * operator would need for support/debugging actually land a REAL row in
 * intake_audit_log (never silently swallowed): message processed, sender
 * rejected, unsupported message, rate limited, channel not found, invalid
 * signature, status event, attachment failure, send failure.
 *
 * Several of these are only ever incidentally exercised by other stage4/5
 * files through their return-value outcome (`kind: 'rate_limited'` etc.) —
 * only stage5-outbound-failure.test.ts asserts an actual audit-log row
 * today (whatsapp_send_failed). This file asserts the audit row itself for
 * every one of the 9 event types, closing the gap the webhook-handler.ts
 * comment on logWhatsAppAudit() (Stage 5.1) specifically warns about: a
 * Postgres insert failure inside the audit logger's own try/catch
 * (webhook-handler.ts:60-71) is swallowed by design ("best-effort — never
 * let audit logging break message processing"), so a broken audit trail
 * would otherwise go undetected until someone actually needed it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload,
  buildUnsupportedMessagePayload, buildStatusEventPayload, buildMediaMessagePayload, createMockGraphFetch,
  type WhatsAppChannelFixture,
} from '../setup/whatsapp-fixtures'
import type { FormField } from '@/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'
import { commandButtonId } from '@/lib/whatsapp/types'
import { rateLimit } from '@/lib/rate-limit'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage6-audit-${Date.now()}`
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

describe('Stage 6, Part 22 — all 9 WhatsApp audit-log event types produce real DB rows', () => {
  const admin = getAdmin()
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  let registeredRequester: TestUser

  async function auditRowsForMessage(messageId: string) {
    const { data } = await admin.from('intake_audit_log').select('action, metadata').contains('metadata', { externalMessageId: messageId })
    return data ?? []
  }

  beforeAll(async () => {
    fx = await setupConversationFixture({
      runTag: RUN_TAG,
      fields: [
        { id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 },
        { id: 'screenshot', type: 'file', label: 'Screenshot', required: true, order: 1 },
      ],
    })
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    registeredRequester = await createTestUser('stage6-audit-registered', 'Stage6 Audit Registered')
    await admin.from('profiles').update({ mobile_number: '9666900101', whatsapp_enabled: true, is_active: true }).eq('id', registeredRequester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', registeredRequester.id)
    await admin.from('requests').delete().eq('requester_id', registeredRequester.id)
    await admin.auth.admin.deleteUser(registeredRequester.id)
    await wa.cleanup()
    await fx.cleanup()
  }, 60_000)

  it('1. whatsapp_message_processed — a normal inbound message', async () => {
    const mock = createMockGraphFetch()
    const messageId = `wamid.${RUN_TAG}.processed`
    const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919666900101', body: 'Hi', messageId })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toMatchObject({ kind: 'processed' })

    const rows = await auditRowsForMessage(messageId)
    expect(rows.some((r) => r.action === 'whatsapp_message_processed')).toBe(true)
  })

  it('2. whatsapp_sender_rejected — an unregistered mobile number', async () => {
    const mock = createMockGraphFetch()
    const messageId = `wamid.${RUN_TAG}.rejected`
    const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919999900202', body: 'Hi', messageId })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toMatchObject({ kind: 'rejected_sender' })

    const rows = await auditRowsForMessage(messageId)
    expect(rows.some((r) => r.action === 'whatsapp_sender_rejected')).toBe(true)
  })

  it('3. whatsapp_unsupported_message — an unsupported message type', async () => {
    const mock = createMockGraphFetch()
    const messageId = `wamid.${RUN_TAG}.unsupported`
    const rawBody = buildUnsupportedMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919666900101', type: 'sticker', messageId })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toMatchObject({ kind: 'unsupported' })

    const rows = await auditRowsForMessage(messageId)
    expect(rows.some((r) => r.action === 'whatsapp_unsupported_message')).toBe(true)
  })

  it('4. whatsapp_rate_limited — a sender over the per-sender message limit', async () => {
    const rateSender = '919666900303'
    const rateKey = `whatsapp:msg:${fx.orgId}:${rateSender}`
    // Pre-fill the 30-message/60s budget the webhook handler itself uses
    // (lib/whatsapp/webhook-handler.ts:141) so the ONE real webhook call
    // below is what actually trips it — far cheaper than sending 31 full
    // webhook payloads to reach the same state.
    for (let i = 0; i < 30; i++) await rateLimit(rateKey, 30, 60_000)

    const mock = createMockGraphFetch()
    const messageId = `wamid.${RUN_TAG}.ratelimited`
    const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: rateSender, body: 'Hi', messageId })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toMatchObject({ kind: 'rate_limited' })

    const rows = await auditRowsForMessage(messageId)
    expect(rows.some((r) => r.action === 'whatsapp_rate_limited')).toBe(true)
  })

  it('5. whatsapp_channel_not_found — persisted to owner_audit_log, not intake_audit_log', async () => {
    const unknownPhoneNumberId = `unknown-${RUN_TAG}`
    const rawBody = buildTextMessagePayload({ phoneNumberId: unknownPhoneNumberId, from: '919666900404', body: 'Hi', messageId: `wamid.${RUN_TAG}.channelnf` })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: 'sha256=irrelevant-no-channel-to-verify-against' })
    expect(result.outcome).toMatchObject({ kind: 'channel_not_found' })

    // Stage 6 Part 22 bug found by this test, fixed in
    // lib/whatsapp/webhook-handler.ts's logWhatsAppAudit(): a
    // channel_not_found/channel_conflict event has, by definition, no
    // resolvable org (no channel matched the phone_number_id) — but
    // intake_audit_log.org_id is NOT NULL, so every such insert was failing
    // a Postgres not-null violation and being silently swallowed by the
    // surrounding try/catch (the same failure class as the Stage 5.1
    // entity_id-type bug documented elsewhere in this file). Fixed by
    // routing org-less events to owner_audit_log instead, which already
    // models a nullable org_id for exactly this kind of platform-level,
    // pre-org event.
    const { data: intakeRows } = await admin.from('intake_audit_log').select('action').contains('metadata', { phoneNumberId: unknownPhoneNumberId }).eq('action', 'whatsapp_channel_not_found')
    expect(intakeRows?.length ?? 0).toBe(0)

    const { data: ownerRows } = await admin.from('owner_audit_log').select('action, metadata').contains('metadata', { phoneNumberId: unknownPhoneNumberId }).eq('action', 'whatsapp_channel_not_found')
    expect(ownerRows?.length ?? 0).toBe(1)
  })

  it('6. whatsapp_invalid_signature — a payload signed with the wrong secret', async () => {
    const { count: before } = await admin.from('intake_audit_log').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId).eq('entity_id', wa.channelId).eq('action', 'whatsapp_invalid_signature')

    const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: '919666900505', body: 'Hi', messageId: `wamid.${RUN_TAG}.badsig` })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, 'not-the-real-app-secret') })
    expect(result.outcome).toMatchObject({ kind: 'invalid_signature' })

    const { count: after } = await admin.from('intake_audit_log').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId).eq('entity_id', wa.channelId).eq('action', 'whatsapp_invalid_signature')
    expect(after ?? 0).toBeGreaterThan(before ?? 0)
  })

  it('7. whatsapp_status_event — a delivery/read status callback', async () => {
    const statusId = `wamid.status.${RUN_TAG}`
    const rawBody = buildStatusEventPayload({ phoneNumberId: wa.phoneNumberId, status: 'delivered', recipientId: '919666900101', statusId })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret) })
    expect(result.outcome).toMatchObject({ kind: 'status_event' })

    const { data: rows } = await admin.from('intake_audit_log').select('action').contains('metadata', { externalStatusId: statusId }).eq('action', 'whatsapp_status_event')
    expect(rows?.length).toBeGreaterThan(0)
  })

  it('8. whatsapp_attachment_link_failed — the staged object goes missing before Create promotes it', async () => {
    const sender = '9666900606'
    const senderMeta = `91${sender}`
    const requester = await createTestUser('stage6-audit-attach', 'Stage6 Audit Attachment')
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)

    try {
      const mock = createMockGraphFetch()
      mock.setMediaFixture('media-audit-fail', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
      const r2 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: RUN_TAG }))
      const conversationId = (r2.outcome as { conversationId: string }).conversationId
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: RUN_TAG }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: RUN_TAG }))
      const rSubject = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer not working', runTag: RUN_TAG }))
      expect(rSubject.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })
      await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-audit-fail', mimeType: 'image/jpeg', fileName: 'screenshot.jpg', runTag: RUN_TAG }))

      // The attachment is now genuinely staged (a real object at a real
      // storage path) — corrupt the path AFTER staging so the automatic
      // promotion move inside the upcoming CREATE call fails organically,
      // for real, inside the one real webhook request whose own audit call
      // (webhook-handler.ts:195-201) this test is proving.
      const { data: attachments } = await admin.from('conversation_attachments').select('id, storage_path').eq('conversation_id', conversationId)
      expect(attachments).toHaveLength(1)
      await admin.from('conversation_attachments').update({ storage_path: `${attachments![0].storage_path}-does-not-exist` }).eq('id', attachments![0].id)

      const createMessageId = `wamid.${RUN_TAG}.attachfail-create`
      const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', messageId: createMessageId }))
      expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

      const { data: created } = await admin.from('requests').select('id').eq('requester_id', requester.id).single()
      const { data: rows } = await admin.from('intake_audit_log').select('action, metadata').eq('entity_id', created!.id).eq('action', 'whatsapp_attachment_link_failed')
      expect(rows?.length).toBeGreaterThan(0)
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
    }
  })

  it('9. whatsapp_send_failed — an outbound delivery that never recovers', async () => {
    const sender = '9666900707'
    const senderMeta = `91${sender}`
    const requester = await createTestUser('stage6-audit-sendfail', 'Stage6 Audit Send Failure')
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)

    try {
      const mock = createMockGraphFetch()
      mock.setSendFailure({ status: 500, body: { error: { message: 'Internal Server Error' } } })
      const messageId = `wamid.${RUN_TAG}.sendfail`
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', messageId })
      const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
      expect(result.outcome).toMatchObject({ kind: 'processed', deliveryFailed: true })

      const rows = await auditRowsForMessage(messageId)
      expect(rows.some((r) => r.action === 'whatsapp_send_failed')).toBe(true)
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
    }
  })
})
