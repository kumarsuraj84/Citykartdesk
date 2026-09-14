/**
 * Stage 5, Step 30 — tenant isolation proven from Meta's own
 * phone_number_id through to ticket creation (AC-5.21). Two distinct Meta
 * phone numbers, each mapped to a different org's WhatsApp channel; the
 * SAME requester mobile number is used in both orgs to prove there is no
 * cross-tenant resolution anywhere in the pipeline.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'
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
const RUN_TAG = `stage5-tenant-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]
const SHARED_MOBILE = '9666500001'

describe('Stage 5 — tenant isolation from Meta phone_number_id through ticket creation', () => {
  let fxA: ConversationFixture
  let fxB: ConversationFixture
  let waA: WhatsAppChannelFixture
  let waB: WhatsAppChannelFixture
  let orgBId: string
  let requesterA: TestUser
  let requesterB: TestUser
  const admin = getAdmin()

  beforeAll(async () => {
    const { data: orgB, error } = await admin.from('organizations').insert({ name: `Stage5 Tenant Org B ${RUN_TAG}`, slug: `stage5-tenant-org-b-${RUN_TAG}` }).select('id').single()
    if (error || !orgB) throw new Error(`[stage5 tenant] org B: ${error?.message}`)
    orgBId = orgB.id

    fxA = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    fxB = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS, orgId: orgBId })
    waA = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-a`, orgId: fxA.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}1` })
    waB = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: orgBId, phoneNumberId: `1555${RUN_TAG.slice(-5)}2` })

    requesterA = await createTestUser('stage5-tenant-req-a', 'Stage5 Tenant Requester A')
    requesterB = await createTestUser('stage5-tenant-req-b', 'Stage5 Tenant Requester B')
    await admin.from('profiles').update({ mobile_number: SHARED_MOBILE, whatsapp_enabled: true, is_active: true }).eq('id', requesterA.id)
    await admin.from('profiles').update({ org_id: orgBId, mobile_number: SHARED_MOBILE, whatsapp_enabled: true, is_active: true }).eq('id', requesterB.id)
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', orgBId)
    // fxA.orgId is the shared seed org used by many test files — scope by
    // this run's own external_message_id prefix too (Stage 4's own
    // tenant-isolation test precedent), not a blanket org_id delete, so a
    // concurrently-recorded row from another file's own (not-yet-run)
    // cleanup is never touched.
    await admin.from('conversation_events').delete().eq('org_id', fxA.orgId).ilike('external_message_id', `wamid.${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', requesterA.id)
    await admin.from('request_conversations').delete().eq('org_id', orgBId)
    await admin.from('requests').delete().eq('requester_id', requesterA.id)
    await admin.from('requests').delete().eq('org_id', orgBId)
    await admin.auth.admin.deleteUser(requesterA.id)
    await admin.auth.admin.deleteUser(requesterB.id)
    await waA.cleanup()
    await waB.cleanup()
    await fxA.cleanup()
    await fxB.cleanup()
    await deleteTestOrg(admin, orgBId)
  }, 60_000)

  it('the identical sender mobile number resolves to two completely distinct conversations/requesters depending on which Meta phone number it messaged', async () => {
    const mock = createMockGraphFetch()
    const senderMeta = `91${SHARED_MOBILE}`

    const sendTo = async (wa: WhatsAppChannelFixture, body: string) => {
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body, runTag: `${RUN_TAG}-${wa.orgId}` })
      return processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    }

    const rA = await sendTo(waA, 'Hi')
    expect(rA.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

    const rB = await sendTo(waB, 'Hi')
    expect(rB.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

    if (rA.outcome.kind === 'processed' && rB.outcome.kind === 'processed') {
      expect(rA.outcome.conversationId).not.toBe(rB.outcome.conversationId)
    }

    const rowA = await admin.from('request_conversations').select('org_id, requester_id').eq('id', (rA.outcome as { conversationId: string }).conversationId).single()
    const rowB = await admin.from('request_conversations').select('org_id, requester_id').eq('id', (rB.outcome as { conversationId: string }).conversationId).single()
    expect(rowA.data?.org_id).toBe(fxA.orgId)
    expect(rowA.data?.requester_id).toBe(requesterA.id)
    expect(rowB.data?.org_id).toBe(orgBId)
    expect(rowB.data?.requester_id).toBe(requesterB.id)
  })

  it('completing a ticket via Org B\'s channel produces a request scoped only to Org B', async () => {
    const mock = createMockGraphFetch()
    const senderMeta = `91${SHARED_MOBILE}`
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, waB.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: waB.phoneNumberId, from: senderMeta, body: 'New', runTag: `${RUN_TAG}-tenantB2` }))
    await send(buildInteractivePayload({ phoneNumberId: waB.phoneNumberId, from: senderMeta, replyId: fxB.serviceId, runTag: `${RUN_TAG}-tenantB2` }))
    await send(buildTextMessagePayload({ phoneNumberId: waB.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: `${RUN_TAG}-tenantB2` }))
    await send(buildInteractivePayload({ phoneNumberId: waB.phoneNumberId, from: senderMeta, replyId: fxB.subCategoryId, runTag: `${RUN_TAG}-tenantB2` }))
    await send(buildTextMessagePayload({ phoneNumberId: waB.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: `${RUN_TAG}-tenantB2` }))
    await send(buildTextMessagePayload({ phoneNumberId: waB.phoneNumberId, from: senderMeta, body: 'Printer not working', runTag: `${RUN_TAG}-tenantB2` }))
    const rCreate = await send(buildInteractivePayload({ phoneNumberId: waB.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: `${RUN_TAG}-tenantB2` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: created } = await admin.from('requests').select('org_id').eq('requester_id', requesterB.id).single()
    expect(created?.org_id).toBe(orgBId)
    expect(created?.org_id).not.toBe(fxA.orgId)
  })
})
