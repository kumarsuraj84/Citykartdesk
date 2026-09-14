/**
 * Stage 5.1, Part 4 — outbound webhook send-failure audit and hardening.
 * See STAGE_5_1_REPORT.md "Webhook Response / Outbound Failure Review" for
 * the full documented behavior; this proves the concrete pieces of it: a
 * transient (retryable) send failure recovers within the same request via
 * sendAll()'s bounded retry, and a persistent failure is never silently
 * dropped — it's surfaced both in the returned outcome and the audit log.
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

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage5-outbound-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]

describe('Stage 5.1 — outbound send-failure recovery', () => {
  const admin = getAdmin()

  it('a transient (retryable) 503 recovers within the same request — Stage 4 state advances AND the prompt is actually delivered', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-a`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}1` })
    const requester = await createTestUser('stage5-outbound-req-a', 'Stage5 Outbound A')
    const sender = '9666900001'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      // Fails the first 2 send attempts (both within sendAll()'s 2-retry
      // budget: initial attempt + 2 retries = 3 total tries), then recovers.
      mock.setSendFailure({ status: 503, body: { error: { message: 'Service Unavailable' } } }, 2)
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG })

      const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
      expect(result.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
      expect((result.outcome as { deliveryFailed?: boolean }).deliveryFailed).toBeFalsy() // ultimately delivered

      const sendAttempts = mock.calls.filter((c) => c.url.includes('/messages') && c.init?.method === 'POST')
      expect(sendAttempts.length).toBeGreaterThanOrEqual(3) // 2 failures + 1 success, all within this single request

      // Scoped by THIS test's own conversation id, not just org+action — the
      // seed org is shared across every test file in a full-suite run, so a
      // sibling file's own whatsapp_send_failed row must never be mistaken
      // for this test's own (non-)result.
      const conversationId = (result.outcome as { conversationId: string }).conversationId
      const { data: audit } = await admin.from('intake_audit_log').select('action, metadata').eq('org_id', fx.orgId).eq('action', 'whatsapp_send_failed')
      const ownRows = (audit ?? []).filter((row) => (row.metadata as { conversationId?: string })?.conversationId === conversationId)
      expect(ownRows).toHaveLength(0) // a recovered send is never reported as a failure
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('a persistent send failure is never silently dropped — Stage 4 state still advanced, but the outcome and audit log both surface the delivery failure', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}2` })
    const requester = await createTestUser('stage5-outbound-req-b', 'Stage5 Outbound B')
    const sender = '9666900002'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      mock.setSendFailure({ status: 500, body: { error: { message: 'Internal Server Error' } } }) // fails every attempt, unbounded
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG })

      const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      // Stage 4's own state transition is unaffected by an outbound
      // delivery problem — the conversation genuinely did advance.
      expect(result.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service', deliveryFailed: true })

      const conversationId = (result.outcome as { conversationId: string }).conversationId
      const { data: audit } = await admin.from('intake_audit_log').select('action, metadata').eq('org_id', fx.orgId).eq('action', 'whatsapp_send_failed')
      const ownRows = (audit ?? []).filter((row) => (row.metadata as { conversationId?: string })?.conversationId === conversationId)
      expect(ownRows).toHaveLength(1)
      expect((ownRows[0].metadata as { state?: string }).state).toBe('awaiting_service')
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('existing recovery: a structured (select/date/number) prompt the requester never saw is naturally re-asked, never silently misread, if their next reply does not match a valid option', async () => {
    // Not a new mechanism — this documents/proves Stage 4's own existing
    // applyQuestionAnswer() validation already provides real protection for
    // every structured field type even without any Stage 5.1 change: an
    // answer that doesn't match what was actually being asked is rejected
    // and the SAME field is re-prompted, rather than silently accepted as
    // an answer to a question the requester never received.
    const fields: FormField[] = [{
      id: 'urgency', type: 'select', label: 'Urgency', required: true, order: 0,
      options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
    }]
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-c`, fields })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-c`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}3` })
    const requester = await createTestUser('stage5-outbound-req-c', 'Stage5 Outbound C')
    const sender = '9666900003'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      const { buildInteractivePayload } = await import('../setup/whatsapp-fixtures')
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: RUN_TAG }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: RUN_TAG }))
      // Now "awaiting_description" — simulate the requester never having
      // seen it (their client replies with free text unrelated to a
      // structured field, which is fine since description IS free text) —
      // the meaningful case is the NEXT, structured "Urgency" field:
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: RUN_TAG }))

      // The requester "never saw" the Urgency prompt and sends something
      // that isn't one of its valid options.
      const rMismatch = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'not a valid option', runTag: RUN_TAG }))
      expect(rMismatch.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // re-asked, not advanced past it

      // A correct reply afterward still completes the field normally.
      const rFixed = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: 'high', runTag: RUN_TAG }))
      expect(rFixed.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })
})
