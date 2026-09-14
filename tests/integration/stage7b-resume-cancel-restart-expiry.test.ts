/**
 * Stage 7 UAT (Step 19-20 of the Stage 7B execution brief) — UAT-20
 * (Resume), UAT-21 (Cancel with a staged attachment, incl. real Storage
 * cleanup), UAT-22 (Restart), UAT-23 (lazy 24h Expiry with staged-attachment
 * cleanup + "old conversation cannot silently continue").
 *
 * Follows the exact conventions of stage4-expiry.test.ts and
 * stage5-attachment-cleanup.test.ts (both explicitly named as the reference
 * pattern for this exact scenario class): processConversationInbound()
 * called directly against the real conversation engine/real Postgres, with
 * a fake MediaStager standing in only for the one Meta media-download HTTP
 * boundary (never for lib/conversations or lib/requests business logic),
 * and lazy expiry proven via directly aging expires_at in a tagged fixture
 * row rather than waiting real hours.
 */
import { describe, it, expect, vi } from 'vitest'
import { getAdmin, createTestUser } from '../setup/fixtures-d03'
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
import { processConversationInbound, findConversationById, findActiveConversation, findAttachmentsForConversation } from '@/lib/conversations'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `uat7b-8c5d02-resume-${Date.now()}`
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

const FIELDS: FormField[] = [
  { id: 'business_impact', type: 'textarea', label: 'Business Impact', required: true, order: 0 },
  { id: 'screenshot', type: 'file', label: 'Screenshot', required: true, order: 1 },
  { id: 'urgency', type: 'select', label: 'Urgency', required: true, order: 2, options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
]

async function walkToStagedFile(params: {
  admin: ReturnType<typeof getAdmin>
  fx: ConversationFixture
  requesterId: string
  channelIdentity: string
  runTag: string
  stager: MediaStager
}): Promise<{ conversationId: string; titleAfterDescription: string | null | undefined }> {
  const { fx, requesterId, channelIdentity, runTag, stager } = params
  const base = { orgId: fx.orgId, requesterId, channelType: 'whatsapp' as const, channelIdentity }
  const deps = { mediaStager: stager }

  await processConversationInbound({ ...base, externalMessageId: `${runTag}-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() }, deps)
  const r2 = await processConversationInbound({ ...base, externalMessageId: `${runTag}-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({ ...base, externalMessageId: `${runTag}-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({ ...base, externalMessageId: `${runTag}-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() }, deps)
  const rDesc = await processConversationInbound({ ...base, externalMessageId: `${runTag}-description`, kind: 'text', text: 'Printer down since morning.', receivedAt: new Date().toISOString() }, deps)
  const afterDesc = await findConversationById({ admin: params.admin as never, orgId: fx.orgId, id: r2.conversationId })
  expect(rDesc.state).toBe('collecting_fields')
  await processConversationInbound({ ...base, externalMessageId: `${runTag}-impact`, kind: 'text', text: 'Billing counter cannot print receipts.', receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({
    ...base, externalMessageId: `${runTag}-file`, kind: 'file',
    attachment: { externalMediaId: `media-${runTag}`, fileName: 'screenshot.jpg', mimeType: 'image/jpeg', size: JPEG_BYTES.length },
    receivedAt: new Date().toISOString(),
  }, deps)
  return { conversationId: r2.conversationId, titleAfterDescription: afterDesc?.title }
}

describe('Stage 7B — UAT-20: Resume mid-conversation (with a staged attachment), Subject never regenerated', () => {
  const admin = getAdmin()

  it('resumes at the exact next question after a staged file, same conversation row, title untouched', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    const requester = await createTestUser('uat7b-resume-req', 'UAT7B Resume Requester')
    mockedCreateClient.mockResolvedValue(admin as never)
    const channelIdentity = '9700200001'

    try {
      const storagePath = `staging/${fx.orgId}/uat7b-resume/screenshot.jpg`
      await admin.storage.from('request-attachments').upload(storagePath, JPEG_BYTES, { contentType: 'image/jpeg', upsert: true })
      const stager: MediaStager = async () => ({ ok: true, storagePath, mimeType: 'image/jpeg', size: JPEG_BYTES.length })

      const { conversationId, titleAfterDescription } = await walkToStagedFile({ admin, fx, requesterId: requester.id, channelIdentity, runTag: `${RUN_TAG}-a`, stager })
      expect(titleAfterDescription).toBeTruthy()

      // ── "Goes silent, resumes hours later" — reload straight from the DB
      // (Step 32 pattern: nothing here is in-memory) before the next message.
      const beforeResume = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(beforeResume?.state).toBe('collecting_fields')
      expect(beforeResume?.currentFieldId).toBe('urgency') // exact next question
      expect(beforeResume?.requesterId).toBe(requester.id)
      expect(beforeResume?.serviceId).toBe(fx.serviceId)
      expect(beforeResume?.subCategoryId).toBe(fx.subCategoryId)
      expect(beforeResume?.categoryId).toBe(fx.categoryId)
      expect(beforeResume?.description).toBe('Printer down since morning.')
      expect(beforeResume?.title).toBe(titleAfterDescription) // NOT regenerated by the resume itself
      expect(beforeResume?.answers.business_impact).toBe('Billing counter cannot print receipts.')

      const stagedAttachments = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(stagedAttachments).toHaveLength(1)
      expect(stagedAttachments[0].status).toBe('staged')
      expect(stagedAttachments[0].fieldId).toBe('screenshot')

      // ── Resume: the requester's next real message correctly lands on the
      // exact field the conversation was waiting for (urgency), and the
      // Subject/title is still untouched afterward.
      const rResume = await processConversationInbound({
        orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp', channelIdentity,
        externalMessageId: `${RUN_TAG}-a-resume-answer`, kind: 'selection', selectionId: 'high', receivedAt: new Date().toISOString(),
      })
      expect(rResume.state).toBe('review')
      expect(rResume.conversationId).toBe(conversationId) // same conversation row, not a new one

      const afterResume = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(afterResume?.title).toBe(titleAfterDescription) // still not regenerated
      expect(afterResume?.answers.urgency).toBe('high')
      expect(afterResume?.answers.business_impact).toBe('Billing counter cannot print receipts.') // prior answer intact
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  }, 60_000)
})

describe('Stage 7B — UAT-21/22: Cancel (with staged attachment + real Storage cleanup) then Restart', () => {
  const admin = getAdmin()

  it('UAT-21: CANCEL marks the conversation terminal and removes the staged Storage object (not just the DB row)', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    const requester = await createTestUser('uat7b-cancel-req', 'UAT7B Cancel Requester')
    mockedCreateClient.mockResolvedValue(admin as never)
    const channelIdentity = '9700200002'

    try {
      const storagePath = `staging/${fx.orgId}/uat7b-cancel/screenshot.jpg`
      await admin.storage.from('request-attachments').upload(storagePath, JPEG_BYTES, { contentType: 'image/jpeg', upsert: true })
      const stager: MediaStager = async () => ({ ok: true, storagePath, mimeType: 'image/jpeg', size: JPEG_BYTES.length })

      const { conversationId } = await walkToStagedFile({ admin, fx, requesterId: requester.id, channelIdentity, runTag: `${RUN_TAG}-b`, stager })

      const staged = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(staged[0].status).toBe('staged')
      const { data: existsBefore } = await admin.storage.from('request-attachments').download(storagePath)
      expect(existsBefore).toBeTruthy() // real Storage object genuinely present before cancel

      const rCancel = await processConversationInbound({
        orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp', channelIdentity,
        externalMessageId: `${RUN_TAG}-b-cancel`, kind: 'command', text: 'cancel', receivedAt: new Date().toISOString(),
      })
      expect(rCancel.state).toBe('cancelled')

      const row = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(row?.state).toBe('cancelled') // conversation marked terminal

      const { data: existsAfter } = await admin.storage.from('request-attachments').download(storagePath)
      expect(existsAfter).toBeNull() // real Storage object removed, not just the DB row — checked directly against Storage

      const { count: requestCount } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
      expect(requestCount).toBe(0) // no stray ticket from a cancelled draft
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  }, 60_000)

  it('UAT-22: after Cancel, a fresh "Hi"/NEW starts exactly one clean active conversation — no leftover draft', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-c`, fields: FIELDS })
    const requester = await createTestUser('uat7b-restart-req', 'UAT7B Restart Requester')
    mockedCreateClient.mockResolvedValue(admin as never)
    const channelIdentity = '9700200003'
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity }

    try {
      const r1 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-c-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
      const firstConversationId = r1.conversationId
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-c-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })

      const rCancel = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-c-cancel`, kind: 'command', text: 'cancel', receivedAt: new Date().toISOString() })
      expect(rCancel.state).toBe('cancelled')

      const rRestart = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-c-new-again`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
      expect(rRestart.state).toBe('awaiting_service')
      expect(rRestart.conversationId).not.toBe(firstConversationId) // a genuinely new draft, not the cancelled one reused

      // Exactly one ACTIVE conversation for this (org, channel, identity) —
      // the cancelled one is terminal and must not be found as "active".
      const active = await findActiveConversation({ admin: admin as never, orgId: fx.orgId, channelType: 'whatsapp', channelIdentity })
      expect(active?.id).toBe(rRestart.conversationId)

      const { count: totalRows } = await admin
        .from('request_conversations').select('id', { count: 'exact', head: true })
        .eq('org_id', fx.orgId).eq('channel_type', 'whatsapp').eq('channel_identity', channelIdentity)
      expect(totalRows).toBe(2) // the old cancelled row + the new active row — never a 3rd/duplicate active draft

      const oldRow = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: firstConversationId })
      expect(oldRow?.state).toBe('cancelled') // untouched, still terminal

      const newRow = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: rRestart.conversationId })
      expect(newRow?.serviceId).toBeNull() // fresh, no leftover selection carried over from the cancelled draft
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  }, 60_000)
})

describe('Stage 7B — UAT-23: lazy 24h Expiry with staged-attachment cleanup, old conversation cannot silently continue', () => {
  const admin = getAdmin()

  it('an expired conversation with a staged file is reconciled safely: Storage cleaned up, old draft inert, a fresh "Hi" starts cleanly', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-d`, fields: FIELDS })
    const requester = await createTestUser('uat7b-expiry-req', 'UAT7B Expiry Requester')
    mockedCreateClient.mockResolvedValue(admin as never)
    const channelIdentity = '9700200004'
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity }

    try {
      const storagePath = `staging/${fx.orgId}/uat7b-expiry/screenshot.jpg`
      await admin.storage.from('request-attachments').upload(storagePath, JPEG_BYTES, { contentType: 'image/jpeg', upsert: true })
      const stager: MediaStager = async () => ({ ok: true, storagePath, mimeType: 'image/jpeg', size: JPEG_BYTES.length })

      const { conversationId } = await walkToStagedFile({ admin, fx, requesterId: requester.id, channelIdentity, runTag: `${RUN_TAG}-d`, stager })

      // Force into the past directly through the fixture (Step 12/35's own
      // established pattern) — never waiting real hours.
      const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      await admin.from('request_conversations').update({ expires_at: pastIso }).eq('id', conversationId)

      // The old draft "cannot silently continue": the requester's next
      // message (which LOOKS like a valid answer to the field it was
      // waiting on — urgency) must never be silently applied to the expired
      // draft.
      const rNext = await processConversationInbound({
        ...base, externalMessageId: `${RUN_TAG}-d-trigger`, kind: 'selection', selectionId: 'high', receivedAt: new Date().toISOString(),
      })
      expect(rNext.state).toBe('expired')
      expect(rNext.prompt?.type).toBe('expired')

      const expiredRow = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(expiredRow?.state).toBe('expired')
      expect(expiredRow?.expiredAt).toBeTruthy()
      expect(expiredRow?.answers.urgency).toBeUndefined() // the "high" reply was never applied as an answer

      const { data: existsAfter } = await admin.storage.from('request-attachments').download(storagePath)
      expect(existsAfter).toBeNull() // staged attachment cleaned up on expiry, not left orphaned

      // A fresh "Hi" (NEW) starts a genuinely clean conversation.
      const rNew = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-d-fresh-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
      expect(rNew.state).toBe('awaiting_service')
      expect(rNew.conversationId).not.toBe(conversationId)
      const freshRow = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: rNew.conversationId })
      expect(freshRow?.serviceId).toBeNull()
      expect(freshRow?.answers).toEqual({})
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  }, 60_000)
})
