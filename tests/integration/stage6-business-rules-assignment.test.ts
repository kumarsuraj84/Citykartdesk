/**
 * Stage 6, Part 12 — Business Rules/assignment through the REAL WhatsApp
 * conversation path (no bypass). whatsapp-stage1-create-request-core.test.ts
 * already proves a single team-scoped rule fires when createRequestCore() is
 * called directly with source:'whatsapp' — but that calls the shared core
 * function directly, not through processConversationInbound()/the webhook
 * pipeline, and only proves "a rule fires at all", not that the rule
 * engine's per-request CONDITIONS are evaluated against the real fields a
 * WhatsApp-created ticket actually ends up with.
 *
 * This file closes that gap: two business rules, discriminated by
 * sub_category_id (a value that only exists on the request because the
 * WhatsApp conversation's own sub-category-selection step set it), each
 * scoped to a DIFFERENT sub-category and assigning to a DIFFERENT agent.
 * Two full webhook-driven conversations (one per sub-category) must each
 * resolve to exactly the rule that matches their own selection — never the
 * other one — proving the engine genuinely evaluates the real, channel-
 * produced request row rather than being bypassed or short-circuited for
 * this channel.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, createMockGraphFetch,
  type WhatsAppChannelFixture,
} from '../setup/whatsapp-fixtures'
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

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage6-rules-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]

describe('Stage 6, Part 12 — Business Rules genuinely evaluate real fields on WhatsApp-created tickets', () => {
  let fxA: ConversationFixture
  let fxB: ConversationFixture
  let wa: WhatsAppChannelFixture
  let requesterA: TestUser
  let requesterB: TestUser
  let agentA: TestUser
  let agentB: TestUser
  let ruleAId: string
  let ruleBId: string
  const admin = getAdmin()

  beforeAll(async () => {
    // Sequential, not Promise.all: setupConversationFixture derives its
    // team's unique `prefix` from Date.now() alone (no runTag mixed in —
    // see tests/setup/conversation-fixtures.ts), so two calls started in
    // the same millisecond collide on teams_prefix_key. Awaiting them one
    // at a time guarantees distinct timestamps.
    fxA = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    fxB = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fxA.orgId, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })

    ;[requesterA, requesterB, agentA, agentB] = await Promise.all([
      createTestUser('stage6-rules-req-a', 'Stage6 Rules Requester A'),
      createTestUser('stage6-rules-req-b', 'Stage6 Rules Requester B'),
      createTestUser('stage6-rules-agent-a', 'Stage6 Rules Agent A'),
      createTestUser('stage6-rules-agent-b', 'Stage6 Rules Agent B'),
    ])
    const senderA = '9666800001'
    const senderB = '9666800002'
    await admin.from('profiles').update({ mobile_number: senderA, whatsapp_enabled: true, is_active: true }).eq('id', requesterA.id)
    await admin.from('profiles').update({ mobile_number: senderB, whatsapp_enabled: true, is_active: true }).eq('id', requesterB.id)
    await admin.from('profiles').update({ role: 'agent' }).eq('id', agentA.id)
    await admin.from('profiles').update({ role: 'agent' }).eq('id', agentB.id)
    // The "assign" rule action skips any assignee who isn't a member of the
    // request's own team (lib/rules — "who is not on request's team —
    // skipped") — each agent must belong to the team their own fixture's
    // service/sub-category route through.
    await admin.from('team_members').insert({ team_id: fxA.teamId, user_id: agentA.id, org_id: fxA.orgId })
    await admin.from('team_members').insert({ team_id: fxB.teamId, user_id: agentB.id, org_id: fxB.orgId })

    const { data: ruleA, error: ruleAErr } = await admin
      .from('business_rules')
      .insert({
        org_id: fxA.orgId,
        name: `Stage6 Rule A (sub_category_id=A) ${RUN_TAG}`,
        trigger: ['created'],
        conditions: [{ field: 'sub_category_id', operator: 'equals', value: fxA.subCategoryId }],
        actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [agentA.id] } }],
        execution_order: 0,
      })
      .select('id')
      .single()
    if (ruleAErr || !ruleA) throw new Error(`[stage6 rules] rule A: ${ruleAErr?.message}`)
    ruleAId = ruleA.id

    const { data: ruleB, error: ruleBErr } = await admin
      .from('business_rules')
      .insert({
        org_id: fxB.orgId,
        name: `Stage6 Rule B (sub_category_id=B) ${RUN_TAG}`,
        trigger: ['created'],
        conditions: [{ field: 'sub_category_id', operator: 'equals', value: fxB.subCategoryId }],
        actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [agentB.id] } }],
        execution_order: 1,
      })
      .select('id')
      .single()
    if (ruleBErr || !ruleB) throw new Error(`[stage6 rules] rule B: ${ruleBErr?.message}`)
    ruleBId = ruleB.id

    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('business_rules').delete().in('id', [ruleAId, ruleBId])
    await admin.from('team_members').delete().eq('team_id', fxA.teamId).eq('user_id', agentA.id)
    await admin.from('team_members').delete().eq('team_id', fxB.teamId).eq('user_id', agentB.id)
    await admin.from('conversation_events').delete().eq('org_id', fxA.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().in('requester_id', [requesterA.id, requesterB.id])
    await admin.from('requests').delete().in('requester_id', [requesterA.id, requesterB.id])
    for (const u of [requesterA, requesterB, agentA, agentB]) await admin.auth.admin.deleteUser(u.id)
    await wa.cleanup()
    await fxA.cleanup()
    await fxB.cleanup()
  }, 60_000)

  async function createViaWhatsApp(fx: ConversationFixture, senderMeta: string): Promise<string> {
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'generic issue', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Something is not working.', runTag: RUN_TAG }))
    const r = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Subject line here', runTag: RUN_TAG }))
    expect(r.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    const created = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
    expect(created.outcome).toMatchObject({ kind: 'processed', state: 'completed' })
    return (created.outcome as { conversationId: string }).conversationId
  }

  it('a WhatsApp ticket in sub-category A is assigned by Rule A, never Rule B', async () => {
    await createViaWhatsApp(fxA, '91966680000' + '1')
    const { data: requests } = await admin.from('requests').select('id, sub_category_id, assigned_to').eq('requester_id', requesterA.id)
    expect(requests).toHaveLength(1)
    expect(requests![0].sub_category_id).toBe(fxA.subCategoryId)
    expect(requests![0].assigned_to).toBe(agentA.id)
    expect(requests![0].assigned_to).not.toBe(agentB.id)
  })

  it('a WhatsApp ticket in sub-category B is assigned by Rule B, never Rule A', async () => {
    await createViaWhatsApp(fxB, '91966680000' + '2')
    const { data: requests } = await admin.from('requests').select('id, sub_category_id, assigned_to').eq('requester_id', requesterB.id)
    expect(requests).toHaveLength(1)
    expect(requests![0].sub_category_id).toBe(fxB.subCategoryId)
    expect(requests![0].assigned_to).toBe(agentB.id)
    expect(requests![0].assigned_to).not.toBe(agentA.id)
  })
})
