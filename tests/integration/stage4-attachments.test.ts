/**
 * Stage 4, Step 22/38 — durable attachment REFERENCES for a required file
 * field. No binary content is ever downloaded by Stage 4 itself (AC-4.13).
 *
 * Stage 5.1 (Part 3) evolved the readiness contract: a bare reference alone
 * (no injected MediaStager, or one that hasn't produced a 'staged' outcome)
 * must NEVER satisfy a mandatory file field — only Stage 4's own generic,
 * channel-neutral engine decides this, driven entirely by whatever
 * MediaStager the caller injects (see lib/conversations/types.ts). This
 * file proves both halves: no stager -> never satisfied (this is Stage 4
 * running with no transport-specific glue at all, exactly the "generic
 * engine" case these tests exist to cover), and a stager that reports
 * 'staged' -> genuinely satisfied, with zero WhatsApp-specific code needed
 * to prove it (a small in-test fake stands in for lib/whatsapp's real one).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import type { FormField } from '@/types'
import type { MediaStager } from '@/lib/conversations/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processConversationInbound } from '@/lib/conversations/orchestrator'
import { findConversationById, findAttachmentsForConversation } from '@/lib/conversations/repository'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage4-attach-${Date.now()}`

const FIELDS: FormField[] = [
  { id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 },
  { id: 'photo', type: 'file', label: 'Photo', required: true, order: 1 },
]

describe('Stage 4 — required-file attachment persistence', () => {
  let fx: ConversationFixture
  let requester: TestUser
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    requester = await createTestUser('stage4-attach-requester', 'Stage4 Attachments Requester')
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await fx.cleanup()
  }, 60_000)

  it('a required file field surfaces AWAITING_FILE, persists a bare reference that survives reload, but does NOT make the draft review-ready without a stager', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9777777701' }

    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    const conversationId = r2.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
    const rSubject = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-subject`, kind: 'text', text: 'Printer not working', receivedAt: new Date().toISOString() })

    expect(rSubject.state).toBe('awaiting_file')
    expect(rSubject.prompt?.type).toBe('file')

    // No attachment yet — the draft must not be review-ready.
    const beforeAttachment = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(beforeAttachment?.state).toBe('awaiting_file')

    // No MediaStager injected here — this is Stage 4's generic engine with
    // no transport-specific glue at all (the case these tests exist to
    // cover). A bare external_media_id must NEVER be enough on its own
    // (Stage 5.1, Part 3 / AC-5.1.6) — the conversation stays on the file
    // field, re-prompting, not silently advancing.
    const rFile = await processConversationInbound({
      ...base, externalMessageId: `${RUN_TAG}-file`, kind: 'file',
      attachment: { externalMediaId: 'media-ref-123', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 45678 },
      receivedAt: new Date().toISOString(),
    })

    expect(rFile.state).toBe('awaiting_file')
    expect(rFile.prompt?.type).toBe('file')

    // The reference is still durably recorded (survives reload) — just not
    // as a satisfying one.
    const attachments = await findAttachmentsForConversation({ admin: admin as never, conversationId })
    expect(attachments).toHaveLength(1)
    expect(attachments[0].fieldId).toBe('photo')
    expect(attachments[0].externalMediaId).toBe('media-ref-123')
    expect(attachments[0].fileName).toBe('photo.jpg')
    expect(attachments[0].status).toBe('received_reference')

    // Critically: no fake value was ever written into the real, persisted
    // answers — the attachment reference is tracked entirely separately.
    const conversation = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(conversation?.answers.photo).toBeUndefined()
  })

  it('with a MediaStager that reports "staged", the field genuinely becomes review-ready and CREATE succeeds', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9777777703' }
    const stager: MediaStager = async () => ({ ok: true, storagePath: 'staging/fake/path.jpg', mimeType: 'image/jpeg', size: 45678 })
    const deps = { mediaStager: stager }

    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() }, deps)
    const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() }, deps)
    const conversationId = r2.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() }, deps)
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() }, deps)
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() }, deps)
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-subject`, kind: 'text', text: 'Printer not working', receivedAt: new Date().toISOString() }, deps)

    const rFile = await processConversationInbound({
      ...base, externalMessageId: `${RUN_TAG}3-file`, kind: 'file',
      attachment: { externalMediaId: 'media-ref-456', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 45678 },
      receivedAt: new Date().toISOString(),
    }, deps)

    expect(rFile.state).toBe('review')
    expect(rFile.prompt?.review?.ready).toBe(true)

    const attachments = await findAttachmentsForConversation({ admin: admin as never, conversationId })
    expect(attachments[0].status).toBe('staged')
    expect(attachments[0].storagePath).toBe('staging/fake/path.jpg')

    // CREATE succeeds; form_data never contains a photo entry (linking a
    // staged binary into request_attachments is Stage 5's own concern —
    // lib/whatsapp/media.ts — never a fake value written by Stage 4).
    const rCreate = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-create`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() }, deps)
    expect(rCreate.state).toBe('completed')

    const final = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    const { data: created } = await admin.from('requests').select('form_data').eq('id', final!.requestId!).single()
    expect((created?.form_data as Record<string, unknown>).photo).toBeUndefined()
    expect((created?.form_data as Record<string, unknown>).subject).toBe('Printer not working')
  })

  it('with a MediaStager that fails, the field is NOT satisfied and the requester is re-asked with a clear error', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9777777704' }
    const stager: MediaStager = async () => ({ ok: false, reason: 'Disallowed content type' })
    const deps = { mediaStager: stager }

    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}4-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() }, deps)
    const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}4-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() }, deps)
    const conversationId = r2.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}4-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() }, deps)
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}4-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() }, deps)
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}4-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() }, deps)
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}4-subject`, kind: 'text', text: 'Printer not working', receivedAt: new Date().toISOString() }, deps)

    const rFile = await processConversationInbound({
      ...base, externalMessageId: `${RUN_TAG}4-file`, kind: 'file',
      attachment: { externalMediaId: 'media-ref-789', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 45678 },
      receivedAt: new Date().toISOString(),
    }, deps)

    expect(rFile.state).toBe('awaiting_file')
    expect(rFile.prompt?.type).toBe('file')
    expect(rFile.prompt?.message?.toLowerCase()).toContain('disallowed content type')

    const attachments = await findAttachmentsForConversation({ admin: admin as never, conversationId })
    expect(attachments[0].status).toBe('failed')
    expect(attachments[0].lastError).toBe('Disallowed content type')
  })

  it('rejects a text/selection answer while awaiting a file — no fake form_data is ever accepted for a file field', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9777777702' }

    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-subject`, kind: 'text', text: 'Printer not working', receivedAt: new Date().toISOString() })

    const rBadAnswer = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-bad`, kind: 'text', text: 'no photo, sorry', receivedAt: new Date().toISOString() })
    expect(rBadAnswer.state).toBe('awaiting_file')
    expect(rBadAnswer.prompt?.type).toBe('file') // re-prompts for the file, does not silently accept text as an answer

    const attachments = await findAttachmentsForConversation({ admin: admin as never, conversationId: rBadAnswer.conversationId })
    expect(attachments).toHaveLength(0)
  })
})
