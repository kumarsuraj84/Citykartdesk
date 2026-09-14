/**
 * Stage 5, Step 27 — the full IT/Printer example end to end through the real
 * webhook processing pipeline (channel/org resolution, signature
 * verification, sender resolution, Stage 4 conversation engine, rendering,
 * outbound send), using the real Stage 4 engine and a real test DB. Only the
 * outbound Meta HTTP boundary (WhatsAppGraphClient's fetch) is mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, createMockGraphFetch,
  type WhatsAppChannelFixture,
} from '../setup/whatsapp-fixtures'
import type { FormField } from '@/types'

// createRequestCore() -> resolveSlaDeadlines() -> business-hours.ts calls the
// RLS-scoped createClient() internally even though createRequestCore() is
// itself invoked with the admin client — same mock every Stage 4 integration
// test already needs (see STAGE_4_REPORT.md), required again here since this
// is a fresh test file.
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

const RUN_TAG = `stage5-e2e-${Date.now()}`
const SENDER = '9666100001'
const SENDER_META = `91${SENDER}`

const FIELDS: FormField[] = [
  { id: 'affected_counter', type: 'text', label: 'Affected Counter', required: true, order: 0 },
  { id: 'business_impact', type: 'checkbox', label: 'Business Impact', required: true, order: 1 },
]

describe('Stage 5 — full IT/Printer example, real webhook pipeline', () => {
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  let requester: TestUser
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    requester = await createTestUser('stage5-e2e-requester', 'Stage5 E2E Requester')
    await admin.from('profiles').update({ mobile_number: SENDER, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
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

  it('walks Hi -> service -> search -> subcategory -> description -> fields -> review -> create, producing exactly one ticket', async () => {
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    // "Hi" -> generic NEW -> service list
    const r1 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Hi', runTag: RUN_TAG }))
    expect(r1.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

    // Select the service (interactive list reply carries the canonical service uuid)
    const r2 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: fx.serviceId, runTag: RUN_TAG }))
    expect(r2.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_issue_search' })

    // Free-text issue search
    const r3 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'printer issue', runTag: RUN_TAG }))
    expect(r3.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_subcategory' })

    // Select the sub-category
    const r4 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: fx.subCategoryId, runTag: RUN_TAG }))
    expect(r4.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })

    // Detailed description
    const r5 = await send(buildTextMessagePayload({
      phoneNumberId: wa.phoneNumberId, from: SENDER_META, runTag: RUN_TAG,
      body: 'Billing counter printer is not printing and jobs are stuck since morning.',
    }))
    expect(r5.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    // First mandatory field
    const r6 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Billing Counter 2', runTag: RUN_TAG }))
    expect(r6.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    // Second mandatory field (checkbox — "Yes")
    const r7 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Yes', runTag: RUN_TAG }))
    expect(r7.outcome).toMatchObject({ kind: 'processed', state: 'review' })

    // Create — tapping the renderer's own cmd:create button
    const r8 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
    expect(r8.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: requests, count } = await admin
      .from('requests')
      .select('id, title, description, priority, form_data', { count: 'exact' })
      .eq('requester_id', requester.id)
    expect(count).toBe(1)
    expect(requests![0].description).toBe('Billing counter printer is not printing and jobs are stuck since morning.')
    expect((requests![0].form_data as Record<string, unknown>).affected_counter).toBe('Billing Counter 2')
    expect((requests![0].form_data as Record<string, unknown>).business_impact).toBe(true)

    // At least one real outbound send was attempted through the mocked Graph
    // API boundary, carrying the channel's own access token.
    const sendCalls = mock.calls.filter((c) => c.url.includes('/messages') && c.init?.method === 'POST')
    expect(sendCalls.length).toBeGreaterThan(0)
    expect((sendCalls[0].init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${wa.accessToken}`)
  })
})
