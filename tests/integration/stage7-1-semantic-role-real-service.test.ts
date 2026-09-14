/**
 * Stage 7.1 Part 11 — real-service regression for the Subject/Description
 * semantic-role fix, against the REAL, currently-live IT Support Template
 * (migrated this stage: Subject -> semantic_role='request_title',
 * Description -> semantic_role='request_description'). Proves the fix end
 * to end through the actual conversational engine, not just at the unit
 * level: the requester is asked for Phone number and the required
 * Attachment, but is NEVER separately asked for "Subject" or "Description"
 * — and the final ticket's form_data[subjectFieldId]/form_data[descFieldId]
 * exactly match requests.title/requests.description.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, buildMediaMessagePayload,
  createMockGraphFetch, type WhatsAppChannelFixture,
} from '../setup/whatsapp-fixtures'

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
const RUN_TAG = `stage71-semrole-${Date.now()}`

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const IT_SERVICE_ID = '67828964-02a5-4165-bf86-889e1f4863d5'
const IT_TEAM_ID = '20000000-0000-0000-0000-000000000001'
const IT_VPN_SUBCATEGORY_ID = '7ba338c3-8e7c-4afb-a099-51f76c078158' // real "VPN CREATION"
const IT_SUBJECT_FIELD = 'mtiddwhc_1'
const IT_DESCRIPTION_FIELD = 'mtbftqh9_3'

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

describe('Stage 7.1 — Subject/Description semantic-role fix on the real IT Support Template', () => {
  let wa: WhatsAppChannelFixture
  let requester: TestUser
  const admin = getAdmin()
  const sender = '9700900001'
  const senderMeta = `91${sender}`

  beforeAll(async () => {
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: ORG_ID, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    requester = await createTestUser('stage71-semrole-req', 'Stage71 SemanticRole Requester')
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', ORG_ID).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await wa.cleanup()
  }, 60_000)

  it('IT Support: Subject/Description auto-filled and never asked; final ticket stays consistent with form_data', async () => {
    const mock = createMockGraphFetch()
    mock.setMediaFixture('stage71-it-media', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: IT_SERVICE_ID, runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'vpn', runTag: RUN_TAG }))
    const rSubcat = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: IT_VPN_SUBCATEGORY_ID, runTag: RUN_TAG }))
    expect(rSubcat.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })

    const descriptionText = 'Cannot connect to the office VPN from home since this morning.'
    const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: descriptionText, runTag: RUN_TAG }))
    expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    // The very next field asked must be Phone number, NEVER Subject or
    // Description — those are now auto-filled, not asked.
    const { data: afterDescRow } = await admin.from('request_conversations').select('current_field_id, title').eq('requester_id', requester.id).single()
    expect(afterDescRow?.current_field_id).toBe('mtbft8s0_1') // Phone number — Subject/Description skipped entirely
    const generatedTitle = afterDescRow?.title as string
    expect(generatedTitle).toBeTruthy()

    // Answer Phone number.
    const rPhone = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: '9812345699', runTag: RUN_TAG }))
    expect(rPhone.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' }) // straight to Attachments — Subject/Description never in between

    // Answer the required Attachment.
    const rFile = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'stage71-it-media', mimeType: 'image/jpeg', fileName: 'proof.jpg', runTag: RUN_TAG }))
    expect(rFile.outcome).toMatchObject({ kind: 'processed', state: 'review' })

    // Review must show the mapped Subject/Description values, not blanks —
    // confirmed via the persisted conversation row's own answers (the same
    // data buildReviewPrompt() renders from).
    const { data: reviewRow } = await admin.from('request_conversations').select('answers').eq('requester_id', requester.id).single()
    const reviewAnswers = reviewRow?.answers as Record<string, unknown>
    expect(reviewAnswers[IT_SUBJECT_FIELD]).toBe(generatedTitle)
    expect(reviewAnswers[IT_DESCRIPTION_FIELD]).toBe(descriptionText)

    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: request } = await admin.from('requests').select('id, title, description, form_data, team_id').eq('requester_id', requester.id).single()
    expect(request).toBeTruthy()
    // CRITICAL CONSISTENCY GUARANTEE (Stage 7.1 Part 3):
    // form_data[mapped Subject] === requests.title, form_data[mapped Description] === requests.description.
    expect((request!.form_data as Record<string, unknown>)[IT_SUBJECT_FIELD]).toBe(request!.title)
    expect((request!.form_data as Record<string, unknown>)[IT_DESCRIPTION_FIELD]).toBe(request!.description)
    expect(request!.title).toBe(generatedTitle)
    expect(request!.description).toBe(descriptionText)
    expect(request!.team_id).toBe(IT_TEAM_ID) // still routes normally — nothing else about the ticket changed
  }, 60_000)
})
