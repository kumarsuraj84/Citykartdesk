/**
 * Stage 5, Step 26 — the same Meta message id delivered twice must map to
 * the same externalMessageId, dedup through Stage 4's own idempotency
 * ledger, advance state exactly once, and never create a duplicate ticket.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, createMockGraphFetch,
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

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage5-idem-${Date.now()}`
const SENDER = '9666200001'
const SENDER_META = `91${SENDER}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]

describe('Stage 5 — webhook-level idempotency', () => {
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  let requester: TestUser
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    requester = await createTestUser('stage5-idem-requester', 'Stage5 Idempotency Requester')
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: SENDER })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await wa.cleanup()
    await fx.cleanup()
  }, 60_000)

  it('a duplicate Meta message id for the description never advances state twice', async () => {
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Hi', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: fx.serviceId, runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'printer issue', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: fx.subCategoryId, runTag: RUN_TAG }))

    const descriptionMessageId = `${RUN_TAG}-description-msg`
    const descriptionPayload = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Printer down.', messageId: descriptionMessageId })

    const first = await send(descriptionPayload)
    expect(first.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    // Redeliver the EXACT same payload (Meta's own retry behavior on a slow ack).
    const second = await send(descriptionPayload)
    expect(second.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    // The next real question is still "Subject" — the duplicate must not
    // have been re-applied as an answer to it.
    const third = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Printer not working', runTag: RUN_TAG }))
    expect(third.outcome).toMatchObject({ kind: 'processed', state: 'review' })

    const createMessageId = `${RUN_TAG}-create-msg`
    const createPayload = buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: commandButtonId('create'), kind: 'button_reply', messageId: createMessageId })

    await send(createPayload)
    await send(createPayload) // duplicate CREATE delivery
    await send(createPayload) // and a third, for good measure

    const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('requester_id', requester.id)
    expect(count).toBe(1)
  })
})
