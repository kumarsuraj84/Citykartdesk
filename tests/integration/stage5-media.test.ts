/**
 * Stage 5.1, Part 3 — required media over WhatsApp, staged BEFORE Review/
 * Create (not deferred to post-Create like Stage 5's original design). A
 * media id is parsed, retrieved, validated, and durably stored at
 * inbound-file-message time; only a genuinely STAGED attachment satisfies
 * a mandatory field's readiness (AC-5.1.6/5.1.7); Create promotes the
 * already-staged binary (MOVE, never a second Meta download — AC-5.1.9);
 * staged media survives a Create-time rejection for retry (AC-5.1.10); a
 * post-Create link failure never creates a duplicate ticket and leaves a
 * recoverable staged object (AC-5.1.11); a fresh DB reload still
 * recognizes an already-staged attachment (AC-5.1.8).
 */
import { describe, it, expect, vi } from 'vitest'
import { getAdmin, createTestUser } from '../setup/fixtures-d03'
import { setupConversationFixture } from '../setup/conversation-fixtures'
import { setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, buildMediaMessagePayload, createMockGraphFetch } from '../setup/whatsapp-fixtures'
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
import { findAttachmentsForConversation, findConversationById, processConversationInbound } from '@/lib/conversations'
import { linkConversationAttachmentsToRequest } from '@/lib/whatsapp/media'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage5-media-${Date.now()}`
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const FIELDS: FormField[] = [
  { id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 },
  { id: 'screenshot', type: 'file', label: 'Screenshot', required: true, order: 1 },
]

/** Walks NEW through the field just before the required-file prompt,
 *  returning the conversationId. */
async function walkToAwaitingFile(params: {
  admin: ReturnType<typeof getAdmin>
  mock: ReturnType<typeof createMockGraphFetch>
  phoneNumberId: string
  appSecret: string
  senderMeta: string
  serviceId: string
  subCategoryId: string
  runTag: string
}): Promise<string> {
  const { admin, mock, phoneNumberId, appSecret, senderMeta, serviceId, subCategoryId, runTag } = params
  const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, appSecret), fetchImpl: mock.fetchImpl })

  await send(buildTextMessagePayload({ phoneNumberId, from: senderMeta, body: 'Hi', runTag }))
  const r2 = await send(buildInteractivePayload({ phoneNumberId, from: senderMeta, replyId: serviceId, runTag }))
  const conversationId = (r2.outcome as { conversationId: string }).conversationId
  await send(buildTextMessagePayload({ phoneNumberId, from: senderMeta, body: 'printer issue', runTag }))
  await send(buildInteractivePayload({ phoneNumberId, from: senderMeta, replyId: subCategoryId, runTag }))
  await send(buildTextMessagePayload({ phoneNumberId, from: senderMeta, body: 'Printer down.', runTag }))
  const rSubject = await send(buildTextMessagePayload({ phoneNumberId, from: senderMeta, body: 'Printer not working', runTag }))
  expect(rSubject.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })
  return conversationId
}

describe('Stage 5.1 — required media staged before Review/Create', () => {
  const admin = getAdmin()

  it('a valid image is staged immediately (review-ready right away) and Create MOVES it without a second Meta download', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-a`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}1` })
    const requester = await createTestUser('stage5-media-req-a', 'Stage5 Media A')
    const sender = '9666600001'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      mock.setMediaFixture('media-valid-jpeg', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      const conversationId = await walkToAwaitingFile({ admin, mock, phoneNumberId: wa.phoneNumberId, appSecret: wa.appSecret, senderMeta, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: RUN_TAG })

      const rMedia = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-valid-jpeg', mimeType: 'image/jpeg', fileName: 'screenshot.jpg', runTag: RUN_TAG }))
      // Staged BEFORE Review is even reached — not deferred to post-Create.
      expect(rMedia.outcome).toMatchObject({ kind: 'processed', state: 'review' })

      const staged = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(staged[0].status).toBe('staged')
      expect(staged[0].storagePath).toMatch(/^staging\//)
      const mediaCallsAfterStaging = mock.calls.filter((c) => c.url.includes('media-valid-jpeg') || c.url.includes('mock-media.example')).length
      expect(mediaCallsAfterStaging).toBeGreaterThan(0) // the ONE genuine retrieval

      const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
      expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

      // No-redownload proof: zero ADDITIONAL calls to Meta's media endpoints
      // happened after Create — promotion reused the already-staged bytes.
      const mediaCallsAfterCreate = mock.calls.filter((c) => c.url.includes('media-valid-jpeg') || c.url.includes('mock-media.example')).length
      expect(mediaCallsAfterCreate).toBe(mediaCallsAfterStaging)

      const linked = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(linked[0].status).toBe('linked')

      const { data: created } = await admin.from('requests').select('id, form_data').eq('requester_id', requester.id).single()
      expect((created!.form_data as Record<string, unknown>).screenshot).toBeUndefined()

      const { data: linkedAttachment } = await admin.from('request_attachments').select('*').eq('request_id', created!.id).single()
      expect(linkedAttachment).toBeTruthy()
      expect(linkedAttachment!.mime_type).toBe('image/jpeg')
      expect(linkedAttachment!.file_name).toBe('screenshot.jpg')
      // The FINAL object genuinely exists (a real move happened, not just a DB update).
      const { data: dl } = await admin.storage.from('request-attachments').download(linkedAttachment!.storage_path)
      expect(dl).toBeTruthy()
      // ...and the staging copy no longer does (moved, not copied).
      const { data: stagingLeftover } = await admin.storage.from('request-attachments').download(staged[0].storagePath!)
      expect(stagingLeftover).toBeNull()

      await admin.storage.from('request-attachments').remove([linkedAttachment!.storage_path])
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('invalid content fails staging immediately — never satisfies, never reaches Review; a valid retry then succeeds', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}2` })
    const requester = await createTestUser('stage5-media-req-b', 'Stage5 Media B')
    const sender = '9666600002'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      // Declares image/jpeg but the bytes are plain text — a spoofed MIME type.
      mock.setMediaFixture('media-spoofed', { mimeType: 'image/jpeg', buffer: Buffer.from('not actually a jpeg') })
      mock.setMediaFixture('media-valid-retry', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      const conversationId = await walkToAwaitingFile({ admin, mock, phoneNumberId: wa.phoneNumberId, appSecret: wa.appSecret, senderMeta, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: RUN_TAG })

      const rBad = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-spoofed', mimeType: 'image/jpeg', fileName: 'fake.jpg', runTag: RUN_TAG }))
      expect(rBad.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' }) // never advances to review

      const afterBad = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(afterBad[0].status).toBe('failed')
      expect(afterBad[0].lastError).toBeTruthy()

      const { count: countBeforeRetry } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('requester_id', requester.id)
      expect(countBeforeRetry).toBe(0) // no ticket was ever created off the bad attachment

      // Retry with a genuinely valid file.
      const rGood = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-valid-retry', mimeType: 'image/jpeg', fileName: 'real.jpg', runTag: RUN_TAG }))
      expect(rGood.outcome).toMatchObject({ kind: 'processed', state: 'review' })

      const afterGood = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(afterGood.some((a) => a.status === 'staged')).toBe(true)

      // This test deliberately stops at 'review' (never CREATE, never
      // CANCEL) — so the genuinely-staged object from the valid retry is
      // still sitting at its staging path; remove it explicitly so the
      // test doesn't leak a real Storage object every run.
      const staged = afterGood.find((a) => a.status === 'staged')
      if (staged?.storagePath) await admin.storage.from('request-attachments').remove([staged.storagePath])
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('a Meta media download failure also fails staging cleanly — never satisfies the field', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-c`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-c`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}3` })
    const requester = await createTestUser('stage5-media-req-c', 'Stage5 Media C')
    const sender = '9666600003'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      // No fixture registered for 'media-missing' — the metadata lookup 404s.
      const mock = createMockGraphFetch()
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      const conversationId = await walkToAwaitingFile({ admin, mock, phoneNumberId: wa.phoneNumberId, appSecret: wa.appSecret, senderMeta, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: RUN_TAG })
      const rMissing = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-missing', mimeType: 'image/jpeg', fileName: 'gone.jpg', runTag: RUN_TAG }))

      expect(rMissing.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })
      const attachments = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(attachments[0].status).toBe('failed')
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('rejects a text answer while awaiting a required file — no fake attachment is ever created', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-d`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-d`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}4` })
    const requester = await createTestUser('stage5-media-req-d', 'Stage5 Media D')
    const sender = '9666600004'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
      const conversationId = await walkToAwaitingFile({ admin, mock, phoneNumberId: wa.phoneNumberId, appSecret: wa.appSecret, senderMeta, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: RUN_TAG })

      const rBadAnswer = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'no photo, sorry', runTag: RUN_TAG }))
      expect(rBadAnswer.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })

      const attachments = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(attachments).toHaveLength(0)
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('process-restart after staging — a fresh DB reload still recognizes the staged attachment (AC-5.1.8)', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-e`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-e`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}5` })
    const requester = await createTestUser('stage5-media-req-e', 'Stage5 Media E')
    const sender = '9666600005'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      mock.setMediaFixture('media-restart', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      const conversationId = await walkToAwaitingFile({ admin, mock, phoneNumberId: wa.phoneNumberId, appSecret: wa.appSecret, senderMeta, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: RUN_TAG })
      await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-restart', mimeType: 'image/jpeg', fileName: 'screenshot.jpg', runTag: RUN_TAG }))

      // Discard everything in-process and reload purely from the DB —
      // simulates a server restart between staging and the next message.
      const reloaded = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(reloaded?.state).toBe('review')
      const reloadedAttachments = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(reloadedAttachments[0].status).toBe('staged')

      const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
      expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

      const { data: created } = await admin.from('requests').select('id').eq('requester_id', requester.id).single()
      await admin.from('request_attachments').select('storage_path').eq('request_id', created!.id).single().then(async ({ data }) => {
        if (data) await admin.storage.from('request-attachments').remove([data.storage_path])
      })
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('a Create-time rejection (temporarily-ineligible requester) retains the staged attachment for a successful retry, with no re-download (AC-5.1.10)', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-f`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-f`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}6` })
    const requester = await createTestUser('stage5-media-req-f', 'Stage5 Media F')
    const sender = '9666600006'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      mock.setMediaFixture('media-retry-create', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      const conversationId = await walkToAwaitingFile({ admin, mock, phoneNumberId: wa.phoneNumberId, appSecret: wa.appSecret, senderMeta, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: RUN_TAG })
      await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-retry-create', mimeType: 'image/jpeg', fileName: 'screenshot.jpg', runTag: RUN_TAG }))

      const stagedBefore = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(stagedBefore[0].status).toBe('staged')
      const mediaCallsAfterStaging = mock.calls.filter((c) => c.url.includes('media-retry-create') || c.url.includes('mock-media.example')).length

      // Make the requester temporarily ineligible so CREATE is rejected —
      // Stage 4's own requester-eligibility recheck (Step 26), a genuine
      // Create-time rejection that leaves the conversation in 'review'.
      //
      // Driven directly through processConversationInbound() (Stage 4's own
      // entry point) rather than the full WhatsApp webhook pipeline for
      // just this one toggle: isRequesterStillEligible() and Stage 2's own
      // per-message sender resolution both key off the SAME profiles.is_active
      // column, so deactivating the requester would also block the webhook
      // from ever resolving the sender for a REAL inbound message — masking
      // the specific Stage 4 eligibility-recheck path this test exists to
      // prove. Testing Stage 4's own mechanism at the Stage 4 level (exactly
      // how stage4-attachments.test.ts already tests Stage 4 directly) keeps
      // this test honest about what it's actually proving.
      await admin.from('profiles').update({ is_active: false }).eq('id', requester.id)
      const rBlocked = await processConversationInbound({
        externalMessageId: `${RUN_TAG}f-create-blocked`, orgId: fx.orgId, requesterId: requester.id,
        channelType: 'whatsapp', channelIdentity: senderMeta, kind: 'command', text: 'create', receivedAt: new Date().toISOString(),
      })
      expect(rBlocked.state).toBe('review') // rejected, NOT completed

      const stagedAfterRejection = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(stagedAfterRejection[0].status).toBe('staged') // untouched — never deleted, never re-fetched
      expect(stagedAfterRejection[0].storagePath).toBe(stagedBefore[0].storagePath)

      // Re-eligible, retry through the real webhook pipeline again — succeeds
      // without re-downloading from Meta.
      await admin.from('profiles').update({ is_active: true }).eq('id', requester.id)
      const rRetry = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
      expect(rRetry.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

      const mediaCallsAfterRetry = mock.calls.filter((c) => c.url.includes('media-retry-create') || c.url.includes('mock-media.example')).length
      expect(mediaCallsAfterRetry).toBe(mediaCallsAfterStaging) // no additional Meta media calls at all

      const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('requester_id', requester.id)
      expect(count).toBe(1)

      const { data: created } = await admin.from('requests').select('id').eq('requester_id', requester.id).single()
      const { data: linkedRow } = await admin.from('request_attachments').select('storage_path').eq('request_id', created!.id).single()
      if (linkedRow) await admin.storage.from('request-attachments').remove([linkedRow.storage_path])
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('a post-Create link (promotion) failure never creates a duplicate ticket and leaves the staged object recoverable (AC-5.1.11)', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-g`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-g`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}7` })
    const requester = await createTestUser('stage5-media-req-g', 'Stage5 Media G')
    const sender = '9666600007'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      mock.setMediaFixture('media-link-fail', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      const conversationId = await walkToAwaitingFile({ admin, mock, phoneNumberId: wa.phoneNumberId, appSecret: wa.appSecret, senderMeta, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: RUN_TAG })
      await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'media-link-fail', mimeType: 'image/jpeg', fileName: 'screenshot.jpg', runTag: RUN_TAG }))

      // Bypass the automatic (working) linking path this once, to exercise
      // linkConversationAttachmentsToRequest()'s own failure handling
      // deterministically: an invalid uploaded_by violates
      // request_attachments' FK, forcing the DB insert itself to fail.
      const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
      expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

      // The automatic link already succeeded (proven by the other tests) —
      // reset the attachment back to 'staged' at a FRESH staging path so we
      // can deterministically re-exercise the failure path in isolation.
      // The first, genuinely-successful auto-link already moved a real
      // object to its own final path — remove that one too, so this test
      // doesn't leak it (its DB row is already covered by the `requests`
      // cascade below, but the Storage object itself is not).
      const linkedNow = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      const { data: firstLinked } = await admin.from('request_attachments').select('storage_path').eq('request_id', (await admin.from('requests').select('id').eq('requester_id', requester.id).single()).data!.id)
      if (firstLinked?.[0]?.storage_path) await admin.storage.from('request-attachments').remove([firstLinked[0].storage_path])
      const stagingPath = `staging/${fx.orgId}/${conversationId}/re-stage-for-failure-test.jpg`
      await admin.storage.from('request-attachments').upload(stagingPath, JPEG_BYTES, { contentType: 'image/jpeg', upsert: true })
      await admin.from('conversation_attachments').update({ status: 'staged', storage_path: stagingPath }).eq('id', linkedNow[0].id)

      const { data: created } = await admin.from('requests').select('id').eq('requester_id', requester.id).single()
      const summary = await linkConversationAttachmentsToRequest({
        admin: admin as never, conversationId, requestId: created!.id, requesterId: '00000000-0000-0000-0000-000000000099',
      })
      expect(summary.linked).toBe(0)
      expect(summary.failed).toHaveLength(1)

      const afterFailedLink = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(afterFailedLink[0].status).toBe('failed')
      expect(afterFailedLink[0].lastError).toBeTruthy()
      // The object is still findable — moved back to (recoverable at) its
      // own storage_path, never silently deleted.
      const { data: recoverable } = await admin.storage.from('request-attachments').download(afterFailedLink[0].storagePath!)
      expect(recoverable).toBeTruthy()

      // Exactly ONE ticket exists — the failed promotion never created another.
      const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('requester_id', requester.id)
      expect(count).toBe(1)

      await admin.storage.from('request-attachments').remove([afterFailedLink[0].storagePath!])
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })
})
