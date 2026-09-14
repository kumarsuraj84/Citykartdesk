/**
 * Stage 4, Step 12/35 — lazy expiry. Timestamps are set directly through
 * fixtures rather than waiting real hours (AC-4.7).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser } from '../setup/fixtures-d03'
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
const RUN_TAG = `stage4-expiry-${Date.now()}`

const FIELDS: FormField[] = [{ id: 'business_impact', type: 'textarea', label: 'Business Impact', required: true, order: 0 }]

describe('Stage 4 — expiry', () => {
  let fx: ConversationFixture
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('TEST: an active conversation with expires_at in the past is transitioned to EXPIRED on the next inbound event', async () => {
    const requester = await createTestUser('stage4-expiry-req-a', 'Stage4 Expiry A')
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9555555501' }

    const r1 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const conversationId = r1.conversationId

    // Force the conversation into the past directly through the fixture —
    // never by waiting real hours.
    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
    await admin.from('request_conversations').update({ expires_at: pastIso }).eq('id', conversationId)

    const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-a-msg`, kind: 'text', text: 'anything', receivedAt: new Date().toISOString() })
    expect(r2.state).toBe('expired')
    expect(r2.prompt?.type).toBe('expired')

    const row = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(row?.state).toBe('expired')
    expect(row?.expiredAt).toBeTruthy()

    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
  })

  it('TEST: after expiry, the next NEW starts a genuinely fresh conversation (no stale draft resumed)', async () => {
    const requester = await createTestUser('stage4-expiry-req-b', 'Stage4 Expiry B')
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9555555502' }

    const r1 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const firstConversationId = r1.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })

    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await admin.from('request_conversations').update({ expires_at: pastIso }).eq('id', firstConversationId)

    // Expire it via any inbound event, then start fresh.
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-trigger-expiry`, kind: 'text', text: 'hello', receivedAt: new Date().toISOString() })
    const r3 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-b-new-again`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })

    expect(r3.state).toBe('awaiting_service')
    expect(r3.conversationId).not.toBe(firstConversationId) // a genuinely new row, not the stale draft

    const oldRow = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: firstConversationId })
    expect(oldRow?.state).toBe('expired')
    expect(oldRow?.serviceId).toBe(fx.serviceId) // the old draft's own data is untouched, just inert

    const newRow = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: r3.conversationId })
    expect(newRow?.serviceId).toBeNull() // fresh, no leftover selection from the expired draft

    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
  })

  it('control — a NON-expired conversation resumes normally, unaffected by the expiry check', async () => {
    const requester = await createTestUser('stage4-expiry-req-c', 'Stage4 Expiry C')
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9555555503' }

    const r1 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-c-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const conversationId = r1.conversationId
    // expires_at defaults to ~24h in the future — well within range.

    const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-c-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    expect(r2.state).toBe('awaiting_issue_search')
    expect(r2.conversationId).toBe(conversationId)

    const row = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(row?.state).toBe('awaiting_issue_search')

    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
  })
})
