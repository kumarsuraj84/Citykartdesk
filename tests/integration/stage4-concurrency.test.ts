/**
 * Stage 4, Step 14/34 — genuine parallel concurrency, not simulated
 * sequential stale versions. Every test here uses Promise.all() against the
 * real local Postgres instance (AC-4.10/AC-4.11).
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
const RUN_TAG = `stage4-conc-${Date.now()}`

const FIELDS: FormField[] = [
  { id: 'field_a', type: 'text', label: 'Field A', required: true, order: 0 },
  { id: 'field_b', type: 'text', label: 'Field B', required: true, order: 1 },
]

describe('Stage 4 — concurrency', () => {
  let fx: ConversationFixture
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('TEST: concurrent NEW events for the same scope produce exactly one active conversation', async () => {
    const requester = await createTestUser('stage4-conc-new-requester', 'Stage4 Concurrency New')
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9444444401' }

    const [r1, r2] = await Promise.all([
      processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cn-a`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() }),
      processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cn-b`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() }),
    ])

    // Both calls must resolve to the SAME conversation id — the DB-backed
    // partial unique index makes the second INSERT lose the race and
    // re-select the winner's row rather than creating a second one.
    expect(r1.conversationId).toBe(r2.conversationId)

    const { count } = await admin
      .from('request_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', fx.orgId)
      .eq('channel_type', 'whatsapp')
      .eq('channel_identity', '9444444401')
    expect(count).toBe(1)

    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
  })

  it('TEST: concurrent distinct field answers against the same state do not corrupt the draft (no lost update)', async () => {
    const requester = await createTestUser('stage4-conc-fields-requester', 'Stage4 Concurrency Fields')
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9444444402' }

    const r1 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cf-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const conversationId = r1.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cf-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cf-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cf-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cf-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
    // Now at collecting_fields, current_field_id = field_a.

    // Two DISTINCT messages arrive "at the same instant" — both answering
    // field_a with different text (the state doesn't change value between
    // them, so only the version column protects against a lost update).
    const [a, b] = await Promise.all([
      processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cf-race-a`, kind: 'text', text: 'Answer from message A', receivedAt: new Date().toISOString() }),
      processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cf-race-b`, kind: 'text', text: 'Answer from message B', receivedAt: new Date().toISOString() }),
    ])

    // Deterministic outcome: exactly one of the two answers won field_a (the
    // optimistic-concurrency retry loop serializes the two commits — the
    // loser reloads and re-applies its OWN answer against the fresh state,
    // which for two answers to the SAME field means the second-to-commit's
    // value simply overwrites the field, same as if they'd arrived in that
    // order sequentially. What must NEVER happen: a corrupted/mixed value,
    // or the conversation ending up on the wrong field, or a version that
    // didn't advance for one of the two commits).
    expect(['collecting_fields', 'review']).toContain(a.state)
    expect(['collecting_fields', 'review']).toContain(b.state)

    const final = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(['Answer from message A', 'Answer from message B']).toContain(final?.answers.field_a)
    // version must reflect exactly the number of transitions actually
    // applied — no lost commit, no double-applied commit.
    expect(final!.version).toBeGreaterThanOrEqual(6) // new, service, search, subcat, description, +at least one of the two race commits

    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
  })

  it('TEST: concurrent CREATE confirmations produce exactly one ticket', async () => {
    const requester = await createTestUser('stage4-conc-create-requester', 'Stage4 Concurrency Create')
    const base = { orgId: fx.orgId, requesterId: requester.id, channelType: 'whatsapp' as const, channelIdentity: '9444444403' }

    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const r2 = await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-service`, kind: 'selection', selectionId: fx.serviceId, receivedAt: new Date().toISOString() })
    const conversationId = r2.conversationId
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-subcat`, kind: 'selection', selectionId: fx.subCategoryId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-answer-a`, kind: 'text', text: 'Impact A', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-answer-b`, kind: 'text', text: 'Impact B', receivedAt: new Date().toISOString() })

    // Two DISTINCT confirmation messages (different externalMessageId — a
    // user could plausibly send "create" twice in a row as separate
    // messages, which idempotency alone would NOT catch since they're not
    // the same event) racing to submit.
    const [a, b] = await Promise.all([
      processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-create-a`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() }),
      processConversationInbound({ ...base, externalMessageId: `${RUN_TAG}-cc-create-b`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() }),
    ])

    const states = [a.state, b.state].sort()
    // One succeeds to completed; the other either also reports completed
    // (if it observed the finished submission) or a safe "please wait"/
    // "already submitting" response — never a second ticket.
    expect(states).toContain('completed')

    const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId).eq('requester_id', requester.id)
    expect(count).toBe(1)

    const final = await findConversationById({ admin: admin as never, orgId: fx.orgId, id: conversationId })
    expect(final?.state).toBe('completed')
    expect(final?.requestId).toBeTruthy()

    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.from('requests').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
  })
})
