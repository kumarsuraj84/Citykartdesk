/**
 * Stage 4, Step 13/33 — message idempotency: the same externalMessageId must
 * never advance conversation state twice (AC-4.8).
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
import { findConversationById } from '@/lib/conversations/repository'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage4-idem-${Date.now()}`

const FIELDS: FormField[] = [
  { id: 'business_impact', type: 'textarea', label: 'Business Impact', required: true, order: 0 },
]

describe('Stage 4 — message idempotency', () => {
  let fx: ConversationFixture
  let requester: TestUser
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    requester = await createTestUser('stage4-idem-requester', 'Stage4 Idempotency Requester')
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await fx.cleanup()
  }, 60_000)

  it('TEST: duplicate description message is applied once — the duplicate does not leak into the next field', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9111111111' }

    const r1 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const conversationId = r1.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })

    const descriptionMsgId = `${RUN_TAG}-description-abc123`
    const descriptionInput = { ...base, externalMessageId: descriptionMsgId, kind: 'text' as const, text: 'Printer stopped working since morning.', receivedAt: new Date().toISOString() }

    // Delivery #1: description saved, title generated, state -> collecting_fields.
    const first = await processConversationInbound(descriptionInput)
    expect(first.state).toBe('collecting_fields')
    expect(first.duplicate).toBeFalsy()
    const afterFirst = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(afterFirst?.description).toBe('Printer stopped working since morning.')
    expect(afterFirst?.title).toBeTruthy()
    const titleAfterFirst = afterFirst?.title
    const answersAfterFirst = afterFirst?.answers

    // Delivery #2: SAME externalMessageId — must NOT be treated as an answer
    // to the next field (Business Impact), must NOT regenerate the title,
    // must return the cached result from delivery #1.
    const second = await processConversationInbound(descriptionInput)
    expect(second.duplicate).toBe(true)
    expect(second.state).toBe('collecting_fields')

    const afterSecond = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(afterSecond?.description).toBe('Printer stopped working since morning.')
    expect(afterSecond?.title).toBe(titleAfterFirst)
    expect(afterSecond?.answers).toEqual(answersAfterFirst)
    // Critically: the duplicate's own text ("Printer stopped working since
    // morning.") must never have been applied as the Business Impact answer.
    expect(afterSecond?.answers.business_impact).toBeUndefined()
    expect(afterSecond?.currentFieldId).toBe('business_impact')
  })

  it('TEST: duplicate field answer results in exactly one answer application and one state advancement', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9222222222' }

    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    const conversationId = r2.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}2-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })

    const answerMsgId = `${RUN_TAG}2-answer-xyz789`
    const answerInput = { ...base, externalMessageId: answerMsgId, kind: 'text' as const, text: 'Billing counter cannot print.', receivedAt: new Date().toISOString() }

    const first = await processConversationInbound(answerInput)
    expect(first.state).toBe('review') // only one field on this fixture's form
    expect(first.duplicate).toBeFalsy()

    const second = await processConversationInbound(answerInput)
    expect(second.duplicate).toBe(true)
    expect(second.state).toBe('review')

    const finalConversation = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(finalConversation?.state).toBe('review')
    expect(finalConversation?.answers.business_impact).toBe('Billing counter cannot print.')
  })

  it('TEST: duplicate CREATE produces exactly one request and returns the same request_id', async () => {
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9333333333' }

    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}3-answer`, kind: 'text', text: 'Big impact.', receivedAt: new Date().toISOString() })

    const createMsgId = `${RUN_TAG}3-create-once`
    const createInput = { ...base, externalMessageId: createMsgId, kind: 'command' as const, text: 'CREATE', receivedAt: new Date().toISOString() }

    const first = await processConversationInbound(createInput)
    expect(first.state).toBe('completed')

    const second = await processConversationInbound(createInput)
    expect(second.duplicate).toBe(true)
    expect(second.state).toBe('completed')
    expect(second.conversationId).toBe(first.conversationId)

    const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
    expect(count).toBe(1)
  })
})
