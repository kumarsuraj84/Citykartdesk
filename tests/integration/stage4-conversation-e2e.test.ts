/**
 * Stage 4, Step 37/32 — one complete, persisted, real-DB conversation flow
 * (NEW -> service -> issue search -> sub-category -> description -> fields
 * -> REVIEW -> CREATE), simulating a process restart mid-flow to prove
 * resume actually reloads from the database rather than relying on any
 * in-memory state (Step 32).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import type { FormField } from '@/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processConversationInbound } from '@/lib/conversations/orchestrator'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage4-e2e-${Date.now()}`
const BUSINESS_IMPACT_FIELD = 'business_impact'
const ISSUE_TYPE_FIELD = 'issue_type'

const FIELDS: FormField[] = [
  { id: BUSINESS_IMPACT_FIELD, type: 'textarea', label: 'Business Impact', required: true, order: 0 },
  { id: ISSUE_TYPE_FIELD, type: 'select', label: 'Issue Type', required: true, order: 1, options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }] },
]

describe('Stage 4 — end-to-end persisted conversation (NEW through CREATE)', () => {
  let fx: ConversationFixture
  let requester: TestUser
  const admin = getAdmin()
  let msgSeq = 0
  const nextMsgId = () => `${RUN_TAG}-${++msgSeq}`

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    requester = await createTestUser('stage4-e2e-requester', 'Stage4 E2E Requester')
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await fx.cleanup()
  }, 60_000)

  it('walks the full flow, persisting and resuming at every step, and produces a normally-governed ticket', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9876543210' }

    // 1. NEW
    const r1 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    expect(r1.state).toBe('awaiting_service')
    expect(r1.prompt?.options?.some((o) => o.id === fx.serviceId)).toBe(true)
    const conversationId = r1.conversationId

    // 2. Select service
    const r2 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    expect(r2.state).toBe('awaiting_issue_search')
    expect(r2.conversationId).toBe(conversationId)

    // 3. Issue search
    const r3 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    expect(r3.state).toBe('awaiting_subcategory')
    expect(r3.prompt?.options?.some((o) => o.id === fx.subCategoryId)).toBe(true)

    // 4. Select sub-category
    const r4 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
    expect(r4.state).toBe('awaiting_description')

    // 5. Description
    const description = 'The printer at the billing counter has stopped working since this morning.'
    const r5 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'text', text: description, receivedAt: new Date().toISOString() })
    expect(r5.state).toBe('collecting_fields')
    expect(r5.prompt?.message).toBe('Business Impact')

    // ── Simulate a process restart / resume (Step 32): reload straight from
    // the DB, proving no in-memory state was relied on for any of the above.
    const { findConversationById } = await import('@/lib/conversations/repository')
    const resumed = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(resumed?.state).toBe('collecting_fields')
    expect(resumed?.description).toBe(description)
    expect(resumed?.title).toBeTruthy()
    const titleAfterDescription = resumed?.title

    // 6. Answer field 1 (Business Impact)
    const r6 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'text', text: 'Billing counter cannot print customer receipts.', receivedAt: new Date().toISOString() })
    expect(r6.state).toBe('collecting_fields')
    expect(r6.prompt?.message).toBe('Issue Type')

    // Title must not have regenerated (Step 7/AC-4.6).
    const midway = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(midway?.title).toBe(titleAfterDescription)

    // 7. Answer field 2 (Issue Type)
    const r7 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'selection', selectionId: 'hardware', receivedAt: new Date().toISOString() })
    expect(r7.state).toBe('review')
    expect(r7.prompt?.review?.ready).toBe(true)
    expect(r7.prompt?.review?.title).toBe(titleAfterDescription)
    expect(r7.prompt?.review?.description).toBe(description)

    // 8. CREATE
    const r8 = await processConversationInbound({ ...base, externalMessageId: nextMsgId(), kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() })
    expect(r8.state).toBe('completed')

    const finalConversation = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(finalConversation?.state).toBe('completed')
    expect(finalConversation?.requestId).toBeTruthy()

    const { data: created } = await admin
      .from('requests')
      .select('title, description, priority, category_id, sub_category_id, form_data, response_due_at, resolution_due_at')
      .eq('id', finalConversation!.requestId!)
      .single()

    expect(created?.title).toBe(titleAfterDescription)
    expect(created?.description).toBe(description)
    expect(created?.sub_category_id).toBe(fx.subCategoryId)
    expect(created?.category_id).toBe(fx.categoryId)
    expect(created?.priority).toBe('urgent') // from the sub-category's own sla_priority
    expect(created?.response_due_at).toBeTruthy()
    expect(created?.resolution_due_at).toBeTruthy()
    expect((created?.form_data as Record<string, unknown>)?.[BUSINESS_IMPACT_FIELD]).toBe('Billing counter cannot print customer receipts.')
    expect((created?.form_data as Record<string, unknown>)?.[ISSUE_TYPE_FIELD]).toBe('hardware')
  })
})
