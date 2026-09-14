/**
 * Stage 7 UAT (Step 21 of the Stage 7B execution brief) — UAT-24 (duplicate
 * delivery of the identical Meta message.id) and UAT-25 (near-simultaneous
 * distinct messages / concurrency, no lost update).
 *
 * UAT-24 goes through the REAL webhook-processing pipeline
 * (processWhatsAppWebhookPayload), replaying the identical raw payload/
 * message id through it multiple times, matching stage5-idempotency's own
 * webhook-level pattern (a superset of stage4-idempotency's
 * processConversationInbound-level replay, which stage4-idempotency.test.ts
 * already proves at the state-machine layer). UAT-25 follows
 * stage4-concurrency.test.ts's exact Promise.all() pattern, since genuine
 * parallel concurrency at the webhook layer reduces to the same underlying
 * optimistic-concurrency guarantee already proven there — this file re-runs
 * it end-to-end through processWhatsAppWebhookPayload for Stage 7 evidence.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import { setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, createMockGraphFetch, type WhatsAppChannelFixture } from '../setup/whatsapp-fixtures'
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
const RUN_TAG = `uat7b-8c5d02-dupconc-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'field_a', type: 'text', label: 'Field A', required: true, order: 0 }, { id: 'field_b', type: 'text', label: 'Field B', required: true, order: 1 }]

describe('Stage 7B — UAT-24: replaying the identical Meta message.id produces exactly one state advance / one ticket', () => {
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  let requester: TestUser
  const admin = getAdmin()
  const sender = '9700300001'

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-a`, orgId: fx.orgId, phoneNumberId: `1557${RUN_TAG.slice(-6)}` })
    requester = await createTestUser('uat7b-dup-req', 'UAT7B Duplicate Requester')
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}-a%`)
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await wa.cleanup()
    await fx.cleanup()
  }, 60_000)

  it('the identical Meta message.id, replayed 3 times (a real Meta webhook retry scenario), advances state exactly once and creates exactly one ticket', async () => {
    const senderMeta = `91${sender}`
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: `${RUN_TAG}-a` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: `${RUN_TAG}-a` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: `${RUN_TAG}-a` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: `${RUN_TAG}-a` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: `${RUN_TAG}-a` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Answer A', runTag: `${RUN_TAG}-a` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Answer B', runTag: `${RUN_TAG}-a` }))

    // The exact same raw payload (same Meta message.id, same body) — a real
    // Meta webhook retry replays the byte-identical payload, not just the id.
    const createRawBody = buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: `${RUN_TAG}-a`, messageId: `wamid.${RUN_TAG}-a.create-once` })
    const signature = signPayload(createRawBody, wa.appSecret)

    const first = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody: createRawBody, signatureHeader: signature, fetchImpl: mock.fetchImpl })
    expect(first.outcome).toMatchObject({ kind: 'processed', state: 'completed' })
    const conversationId = (first.outcome as { conversationId: string }).conversationId

    const second = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody: createRawBody, signatureHeader: signature, fetchImpl: mock.fetchImpl })
    const third = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody: createRawBody, signatureHeader: signature, fetchImpl: mock.fetchImpl })

    for (const replay of [second, third]) {
      expect(replay.outcome).toMatchObject({ kind: 'processed', state: 'completed', conversationId })
    }

    const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId).eq('requester_id', requester.id)
    expect(count).toBe(1) // exactly one ticket ever created for this message.id, despite 3 deliveries

    // Filtered server-side on the JSONB metadata path — the seed org's
    // intake_audit_log has accumulated thousands of rows across every prior
    // test session, well past PostgREST's default 1000-row cap, so a plain
    // eq(org_id)+eq(action) fetch-then-filter-in-JS can silently miss this
    // test's own newest rows.
    const { data: processedRows } = await admin
      .from('intake_audit_log')
      .select('metadata')
      .eq('org_id', fx.orgId)
      .eq('action', 'whatsapp_message_processed')
      .eq('metadata->>externalMessageId', `wamid.${RUN_TAG}-a.create-once`)
    const ownProcessedRows = processedRows ?? []
    // Every delivery is individually audited (each webhook call IS real
    // traffic worth recording), but only the first is non-duplicate.
    expect(ownProcessedRows.length).toBe(3)
    const duplicateFlags = ownProcessedRows.map((r) => (r.metadata as { duplicate?: boolean }).duplicate)
    expect(duplicateFlags.filter((d) => d === false).length).toBe(1)
    expect(duplicateFlags.filter((d) => d === true).length).toBe(2)
  }, 60_000)
})

describe('Stage 7B — UAT-25: two near-simultaneous distinct WhatsApp messages — no lost update, no double state advancement', () => {
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: fx.orgId, phoneNumberId: `1558${RUN_TAG.slice(-6)}` })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}-b%`)
    await wa.cleanup()
    await fx.cleanup()
  }, 60_000)

  it('two distinct real messages answering the same pending field, sent back-to-back, resolve deterministically with no corrupted/mixed answer', async () => {
    const requester = await createTestUser('uat7b-conc-fields-req', 'UAT7B Concurrency Fields Requester')
    const sender = '9700300002'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    const senderMeta = `91${sender}`
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    try {
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: `${RUN_TAG}-b` }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: `${RUN_TAG}-b` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: `${RUN_TAG}-b` }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: `${RUN_TAG}-b` }))
      const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: `${RUN_TAG}-b` }))
      expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
      const conversationId = (rDesc.outcome as { conversationId: string }).conversationId

      // Two DISTINCT real WhatsApp messages, both answering field_a, fired
      // genuinely in parallel (Promise.all against the real Postgres
      // instance, not simulated sequentially) — exactly stage4-concurrency's
      // own pattern, run through the full webhook pipeline this time.
      const bodyA = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Answer from message A', runTag: `${RUN_TAG}-b`, messageId: `wamid.${RUN_TAG}-b.race-a` })
      const bodyB = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Answer from message B', runTag: `${RUN_TAG}-b`, messageId: `wamid.${RUN_TAG}-b.race-b` })
      const [ra, rb] = await Promise.all([
        processWhatsAppWebhookPayload({ admin: admin as never, rawBody: bodyA, signatureHeader: signPayload(bodyA, wa.appSecret), fetchImpl: mock.fetchImpl }),
        processWhatsAppWebhookPayload({ admin: admin as never, rawBody: bodyB, signatureHeader: signPayload(bodyB, wa.appSecret), fetchImpl: mock.fetchImpl }),
      ])
      expect(['collecting_fields', 'review']).toContain((ra.outcome as { state: string }).state)
      expect(['collecting_fields', 'review']).toContain((rb.outcome as { state: string }).state)

      const { findConversationById } = await import('@/lib/conversations/repository')
      const final = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      // Exactly one of the two answers won field_a — never a mixed/corrupted
      // value, never lost entirely. (Matching stage4-concurrency.test.ts's
      // own documented outcome: the optimistic-concurrency retry loop
      // serializes the two commits — the loser reloads fresh state and
      // re-applies its OWN answer text against whatever field is CURRENT at
      // that moment. If the winner already advanced to field_b before the
      // loser's retry lands, the loser's text becomes field_b's answer too,
      // and the conversation legitimately reaches 'review' with BOTH fields
      // filled — one from each real message. Either outcome is safe; what
      // must never happen is a corrupted/mixed value or a lost commit.)
      expect(['Answer from message A', 'Answer from message B']).toContain(final?.answers.field_a)
      expect(final!.version).toBeGreaterThanOrEqual(6)
      expect(['collecting_fields', 'review']).toContain(final?.state)
      if (final?.state === 'collecting_fields') {
        expect(final?.currentFieldId).toBe('field_b')
        expect(final?.answers.field_b).toBeUndefined()
      } else {
        // Reached review — field_b was answered by the second-to-commit
        // message; its value must be one of the two real message bodies,
        // never a corrupted/mixed/duplicated string.
        expect(['Answer from message A', 'Answer from message B']).toContain(final?.answers.field_b)
      }
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
    }
  }, 60_000)

  it('two distinct real CREATE confirmations racing at Review produce exactly one ticket', async () => {
    const requester = await createTestUser('uat7b-conc-create-req', 'UAT7B Concurrency Create Requester')
    const sender = '9700300003'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    const senderMeta = `91${sender}`
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    try {
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: `${RUN_TAG}-b2` }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: `${RUN_TAG}-b2` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: `${RUN_TAG}-b2` }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: `${RUN_TAG}-b2` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: `${RUN_TAG}-b2` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Answer A', runTag: `${RUN_TAG}-b2` }))
      const rLast = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Answer B', runTag: `${RUN_TAG}-b2` }))
      expect(rLast.outcome).toMatchObject({ kind: 'processed', state: 'review' })

      const createBodyA = buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: `${RUN_TAG}-b2`, messageId: `wamid.${RUN_TAG}-b2.create-a` })
      const createBodyB = buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: `${RUN_TAG}-b2`, messageId: `wamid.${RUN_TAG}-b2.create-b` })
      const [ra, rb] = await Promise.all([
        processWhatsAppWebhookPayload({ admin: admin as never, rawBody: createBodyA, signatureHeader: signPayload(createBodyA, wa.appSecret), fetchImpl: mock.fetchImpl }),
        processWhatsAppWebhookPayload({ admin: admin as never, rawBody: createBodyB, signatureHeader: signPayload(createBodyB, wa.appSecret), fetchImpl: mock.fetchImpl }),
      ])
      const states = [(ra.outcome as { state: string }).state, (rb.outcome as { state: string }).state]
      expect(states).toContain('completed')

      const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId).eq('requester_id', requester.id)
      expect(count).toBe(1) // exactly one ticket despite two distinct, genuinely racing CREATE confirmations
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
    }
  }, 60_000)
})
