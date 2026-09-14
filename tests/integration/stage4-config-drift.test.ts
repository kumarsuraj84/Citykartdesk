/**
 * Stage 4, Step 25/36 — current DESK configuration remains authoritative
 * even after a draft reaches REVIEW. Neither scenario here may ever create
 * a ticket against stale form data (AC-4.12).
 */
import { describe, it, expect, vi } from 'vitest'
import { getAdmin, createTestUser } from '../setup/fixtures-d03'
import type { ConversationFixture } from '../setup/conversation-fixtures'
import type { FormField } from '@/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processConversationInbound } from '@/lib/conversations/orchestrator'
import { findConversationById } from '@/lib/conversations/repository'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage4-drift-${Date.now()}`

describe('Stage 4 — configuration drift before CREATE', () => {
  const admin = getAdmin()
  // no shared fixture — each test builds and tears down its own service

  it('TEST: a new mandatory field added after REVIEW blocks CREATE and sends the conversation back to collect it', async () => {
    const fields: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]
    const fx: ConversationFixture = await import('../setup/conversation-fixtures').then((m) =>
      m.setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields })
    )
    const requester = await createTestUser('stage4-drift-req-a', 'Stage4 Drift A')
    mockedCreateClient.mockResolvedValue(admin as never)

    try {
      const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9666666601' }
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
      const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
      const conversationId = r2.conversationId
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
      const rReview = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-subject`, kind: 'text', text: 'Printer not working', receivedAt: new Date().toISOString() })
      expect(rReview.state).toBe('review')

      // Drift: admin adds a new mandatory field to the SAME service after
      // this conversation already reached review.
      const newField: FormField = { id: 'urgency', type: 'select', label: 'Urgency', required: true, order: 1, options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] }
      await admin.from('services').update({ form_sections: [{ id: 'sec1', title: 'Details', order: 0, fields: [...fields, newField] }] }).eq('id', fx.serviceId)

      const rCreate = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-create`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() })

      // NO ticket — sent back to collect the new field instead.
      expect(rCreate.state).toBe('collecting_fields')
      expect(rCreate.prompt?.message).toBe('Urgency')

      const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
      expect(count).toBe(0)

      const row = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(row?.state).toBe('collecting_fields')
      expect(row?.requestId).toBeNull()

      // The conversation can still be completed once the new field is answered.
      const rUrgency = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-urgency`, kind: 'selection', selectionId: 'high', receivedAt: new Date().toISOString() })
      expect(rUrgency.state).toBe('review')
      const rCreate2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-create-2`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() })
      expect(rCreate2.state).toBe('completed')
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  })

  it('TEST: a previously-selected option removed from the template invalidates that answer and re-asks the field', async () => {
    const fields: FormField[] = [
      { id: 'issue_type', type: 'select', label: 'Issue Type', required: true, order: 0, options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }] },
    ]
    const fx: ConversationFixture = await import('../setup/conversation-fixtures').then((m) =>
      m.setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields })
    )
    const requester = await createTestUser('stage4-drift-req-b', 'Stage4 Drift B')
    mockedCreateClient.mockResolvedValue(admin as never)

    try {
      const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9666666602' }
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
      const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
      const conversationId = r2.conversationId
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
      await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
      const rReview = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-answer`, kind: 'selection', selectionId: 'hardware', receivedAt: new Date().toISOString() })
      expect(rReview.state).toBe('review')

      // Drift: admin removes the "hardware" option entirely (not merely
      // archived — Step 11's option-membership check deliberately keeps an
      // ARCHIVED option valid forever for an already-submitted answer, so
      // this test models genuine removal from the options list, the one
      // case that actually invalidates a previously-picked value).
      const driftedField: FormField = { ...fields[0], options: [{ value: 'software', label: 'Software' }] }
      await admin.from('services').update({ form_sections: [{ id: 'sec1', title: 'Details', order: 0, fields: [driftedField] }] }).eq('id', fx.serviceId)

      const rCreate = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-create`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() })

      // NO ticket — Step 11's option-membership rule still rejects an
      // archived option's value; the invalidated answer is cleared and
      // Issue Type is asked again from scratch, exactly like a missing field.
      const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
      expect(count).toBe(0)
      expect(rCreate.state).toBe('collecting_fields')
      expect(rCreate.prompt?.message).toBe('Issue Type')

      const row = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
      expect(row?.requestId).toBeNull()
      expect(row?.answers.issue_type).toBeUndefined()

      // The conversation can still be completed by answering with a
      // currently-valid option.
      const rAnswerAgain = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-answer-2`, kind: 'selection', selectionId: 'software', receivedAt: new Date().toISOString() })
      expect(rAnswerAgain.state).toBe('review')
      const rCreate2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-create-2`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() })
      expect(rCreate2.state).toBe('completed')
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await fx.cleanup()
    }
  })
})
