/**
 * Stage 5.1, Part 3 — "Cancel/Expiry Cleanup" (AC-5.1.12). A STAGED
 * attachment's durable Storage object must not outlive the draft it
 * belonged to once the conversation becomes terminal via CANCEL or lazy
 * expiry. Tested at the Stage 4 level (lib/conversations is where the
 * cleanup lives — generic Supabase Storage only, no Meta/WhatsApp-specific
 * code), using a fake MediaStager so no real transport is needed.
 */
import { describe, it, expect, vi } from 'vitest'
import { getAdmin, createTestUser } from '../setup/fixtures-d03'
import { setupConversationFixture } from '../setup/conversation-fixtures'
import type { FormField } from '@/types'
import type { MediaStager } from '@/lib/conversations/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processConversationInbound, findAttachmentsForConversation, findConversationById } from '@/lib/conversations'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage5-cleanup-${Date.now()}`
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

const FIELDS: FormField[] = [
  { id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 },
  { id: 'screenshot', type: 'file', label: 'Screenshot', required: true, order: 1 },
]

async function walkToStagedFile(params: {
  admin: ReturnType<typeof getAdmin>
  orgId: string
  requesterId: string
  channelIdentity: string
  serviceId: string
  subCategoryId: string
  runTag: string
  stager: MediaStager
}): Promise<string> {
  const { orgId, requesterId, channelIdentity, serviceId, subCategoryId, runTag, stager } = params
  const base = { orgId, requesterId, channelType: 'whatsapp' as const, channelIdentity }
  const deps = { mediaStager: stager }

  await processConversationInbound({ ...base, externalMessageId: `${runTag}-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() }, deps)
  const r2 = await processConversationInbound({ ...base, externalMessageId: `${runTag}-service`, kind: 'selection', selectionId: serviceId, receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({ ...base, externalMessageId: `${runTag}-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({ ...base, externalMessageId: `${runTag}-subcat`, kind: 'selection', selectionId: subCategoryId, receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({ ...base, externalMessageId: `${runTag}-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({ ...base, externalMessageId: `${runTag}-subject`, kind: 'text', text: 'Printer not working', receivedAt: new Date().toISOString() }, deps)
  await processConversationInbound({
    ...base, externalMessageId: `${runTag}-file`, kind: 'file',
    attachment: { externalMediaId: 'media-cleanup', fileName: 'screenshot.jpg', mimeType: 'image/jpeg', size: JPEG_BYTES.length },
    receivedAt: new Date().toISOString(),
  }, deps)
  return r2.conversationId
}

describe('Stage 5.1 — staged attachment cleanup on cancel/expiry', () => {
  const admin = getAdmin()

  it('CANCEL removes the staged Storage object for a not-yet-linked attachment', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    const requester = await createTestUser('stage5-cleanup-req-a', 'Stage5 Cleanup A')
    mockedCreateClient.mockResolvedValue(admin as never)
    const channelIdentity = '9666800001'

    try {
      const storagePath = `staging/${fx.orgId}/cleanup-test-a/screenshot.jpg`
      await admin.storage.from('request-attachments').upload(storagePath, JPEG_BYTES, { contentType: 'image/jpeg', upsert: true })
      const stager: MediaStager = async () => ({ ok: true, storagePath, mimeType: 'image/jpeg', size: JPEG_BYTES.length })

      const conversationId = await walkToStagedFile({ admin, orgId: fx.orgId, requesterId: requester.id, channelIdentity, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: `${RUN_TAG}-a`, stager })

      const staged = await findAttachmentsForConversation({ admin: admin as never, conversationId })
      expect(staged[0].status).toBe('staged')
      const { data: existsBefore } = await admin.storage.from('request-attachments').download(storagePath)
      expect(existsBefore).toBeTruthy()

      const rCancel = await processConversationInbound({
        orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp', channelIdentity,
        externalMessageId: `${RUN_TAG}-a-cancel`, kind: 'command', text: 'cancel', receivedAt: new Date().toISOString(),
      })
      expect(rCancel.state).toBe('cancelled')

      const { data: existsAfter } = await admin.storage.from('request-attachments').download(storagePath)
      expect(existsAfter).toBeNull() // removed — no orphan left behind
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  })

  it('lazy EXPIRY removes the staged Storage object for a not-yet-linked attachment', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    const requester = await createTestUser('stage5-cleanup-req-b', 'Stage5 Cleanup B')
    mockedCreateClient.mockResolvedValue(admin as never)
    const channelIdentity = '9666800002'

    try {
      const storagePath = `staging/${fx.orgId}/cleanup-test-b/screenshot.jpg`
      await admin.storage.from('request-attachments').upload(storagePath, JPEG_BYTES, { contentType: 'image/jpeg', upsert: true })
      const stager: MediaStager = async () => ({ ok: true, storagePath, mimeType: 'image/jpeg', size: JPEG_BYTES.length })

      const conversationId = await walkToStagedFile({ admin, orgId: fx.orgId, requesterId: requester.id, channelIdentity, serviceId: fx.serviceId, subCategoryId: fx.subCategoryId, runTag: `${RUN_TAG}-b`, stager })

      // Force the conversation into the past, exactly like Stage 4's own
      // expiry tests (fixture timestamps, never waiting real hours).
      const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      await admin.from('request_conversations').update({ expires_at: pastIso }).eq('id', conversationId)

      const rNext = await processConversationInbound({
        orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp', channelIdentity,
        externalMessageId: `${RUN_TAG}-b-trigger`, kind: 'text', text: 'anything', receivedAt: new Date().toISOString(),
      })
      expect(rNext.state).toBe('expired')

      const reloaded = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(reloaded?.state).toBe('expired')

      const { data: existsAfter } = await admin.storage.from('request-attachments').download(storagePath)
      expect(existsAfter).toBeNull()
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  })
})
