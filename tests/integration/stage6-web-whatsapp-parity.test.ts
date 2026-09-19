/**
 * Stage 6, Part 11 — explicit web-vs-WhatsApp parity. Stage 1's own test
 * (whatsapp-stage1-create-request-core.test.ts) already proves
 * createRequestCore() behaves identically when called directly with
 * source:'web' vs source:'whatsapp', and stage4-conversation-e2e.test.ts
 * proves the full WhatsApp conversation flow produces a normally-governed
 * ticket in isolation — but neither puts a web-submitted ticket and a
 * WhatsApp-submitted ticket, created with EQUIVALENT inputs, side by side
 * and diffs the actual stored rows. That comparison is what this file adds.
 *
 * Both tickets are created through the real, unmodified production paths —
 * createRequest() (the web Server Action) for one, and the full
 * processWhatsAppWebhookPayload() pipeline (same as stage5-webhook-e2e) for
 * the other — with the same service/sub-category selection and the same
 * form field answers, then compared field by field. Only channel-specific
 * bookkeeping (description/title derivation, request_conversations linkage)
 * is expected to differ; every business-derived field must match.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, clientForToken, type TestUser } from '../setup/fixtures-d03'
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
import { createRequest } from '@/lib/actions/requests'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'
import { commandButtonId } from '@/lib/whatsapp/types'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage6-parity-${Date.now()}`
const SENDER = '9666700001'
const SENDER_META = `91${SENDER}`

const BUSINESS_IMPACT_FIELD = 'business_impact'
const ISSUE_TYPE_FIELD = 'issue_type'
const FIELDS: FormField[] = [
  { id: BUSINESS_IMPACT_FIELD, type: 'textarea', label: 'Business Impact', required: true, order: 0 },
  { id: ISSUE_TYPE_FIELD, type: 'select', label: 'Issue Type', required: true, order: 1, options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }] },
]
const ANSWERS = { [BUSINESS_IMPACT_FIELD]: 'Billing counter cannot print customer receipts.', [ISSUE_TYPE_FIELD]: 'hardware' }

describe('Stage 6, Part 11 — web vs WhatsApp ticket-creation parity', () => {
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  let webRequester: TestUser
  let waRequester: TestUser
  let agent: TestUser
  let businessRuleId: string
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS, subCategoryPriority: 'high' })
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })

    ;[webRequester, waRequester, agent] = await Promise.all([
      createTestUser('stage6-parity-web-req', 'Stage6 Parity Web Requester'),
      createTestUser('stage6-parity-wa-req', 'Stage6 Parity WhatsApp Requester'),
      createTestUser('stage6-parity-agent', 'Stage6 Parity Agent'),
    ])
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', waRequester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: waRequester.id, org_id: fx.orgId, mobile_number: SENDER })
    await admin.from('profiles').update({ role: 'agent' }).eq('id', agent.id)
    await admin.from('team_members').insert({ team_id: fx.teamId, user_id: agent.id, org_id: fx.orgId })

    const { data: rule, error: ruleError } = await admin
      .from('business_rules')
      .insert({
        org_id: fx.orgId,
        name: `Stage6 Parity auto-assign ${RUN_TAG}`,
        trigger: ['created'],
        conditions: [{ field: 'team_id', operator: 'equals', value: fx.teamId }],
        actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [agent.id] } }],
        execution_order: 0,
      })
      .select('id')
      .single()
    if (ruleError || !rule) throw new Error(`[stage6 parity] business rule: ${ruleError?.message}`)
    businessRuleId = rule.id
  }, 60_000)

  afterAll(async () => {
    await admin.from('business_rules').delete().eq('id', businessRuleId)
    await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', waRequester.id)
    await admin.from('requests').delete().eq('requester_id', webRequester.id)
    await admin.from('requests').delete().eq('requester_id', waRequester.id)
    await admin.from('team_members').delete().eq('team_id', fx.teamId).eq('user_id', agent.id)
    for (const u of [webRequester, waRequester, agent]) await admin.auth.admin.deleteUser(u.id)
    await wa.cleanup()
    await fx.cleanup()
  }, 60_000)

  it('produces business-identical tickets from equivalent web and WhatsApp submissions', async () => {
    // ── Web path: normal DESK web-form submission ──────────────────────────
    mockedCreateClient.mockResolvedValue(clientForToken(webRequester.accessToken) as never)
    const fd = new FormData()
    fd.set('service_id', fx.serviceId)
    fd.set('sub_category_id', fx.subCategoryId)
    fd.set('form_data', JSON.stringify(ANSWERS))
    const webResult = await createRequest(fd)
    expect(webResult.error).toBeUndefined()
    expect(webResult.requestId).toBeTruthy()

    // ── WhatsApp path: the same selections through the real webhook pipeline ──
    mockedCreateClient.mockResolvedValue(admin as never)
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Hi', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: fx.serviceId, runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'printer issue', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: fx.subCategoryId, runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: 'Billing counter cannot print customer receipts.', runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, body: ANSWERS[BUSINESS_IMPACT_FIELD], runTag: RUN_TAG }))
    const waFieldResult = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: 'hardware', runTag: RUN_TAG }))
    expect(waFieldResult.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    const waCreateResult = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: SENDER_META, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
    expect(waCreateResult.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: waRequests } = await admin.from('requests').select('id').eq('requester_id', waRequester.id)
    expect(waRequests).toHaveLength(1)
    const waRequestId = waRequests![0].id

    // ── Compare the two stored rows ─────────────────────────────────────────
    const cols = 'org_id, service_id, category_id, sub_category_id, team_id, priority, status, assigned_to, form_data, source_metadata, created_at, response_due_at, resolution_due_at, request_no'
    const { data: webRow } = await admin.from('requests').select(cols).eq('id', webResult.requestId!).single()
    const { data: waRow } = await admin.from('requests').select(cols).eq('id', waRequestId).single()

    // Every business-derived field is identical.
    expect(waRow?.org_id).toBe(webRow?.org_id)
    expect(waRow?.service_id).toBe(webRow?.service_id)
    expect(waRow?.category_id).toBe(webRow?.category_id)
    expect(waRow?.sub_category_id).toBe(webRow?.sub_category_id)
    expect(waRow?.team_id).toBe(webRow?.team_id)
    expect(waRow?.priority).toBe(webRow?.priority)
    expect(waRow?.priority).toBe('high') // the sub-category's own sla_priority, on both sides
    expect(waRow?.status).toBe(webRow?.status)
    expect(waRow?.assigned_to).toBe(webRow?.assigned_to)
    expect(waRow?.assigned_to).toBe(agent.id) // same Business Rule fired for both channels
    expect((waRow?.form_data as Record<string, unknown>)?.[BUSINESS_IMPACT_FIELD]).toBe((webRow?.form_data as Record<string, unknown>)?.[BUSINESS_IMPACT_FIELD])
    expect((waRow?.form_data as Record<string, unknown>)?.[ISSUE_TYPE_FIELD]).toBe((webRow?.form_data as Record<string, unknown>)?.[ISSUE_TYPE_FIELD])
    expect(webRow?.request_no).toMatch(/^CKSD-\d{6}$/)
    expect(waRow?.request_no).toMatch(/^CKSD-\d{6}$/)

    // Same SLA math on both sides: the response/resolution windows (measured
    // from each row's own created_at) must be the same duration, even though
    // the absolute due-at timestamps differ (the two tickets were created a
    // few seconds apart). A small (<5s) tolerance absorbs second-precision
    // rounding in the stored timestamps themselves, not any real difference
    // in the SLA computation.
    const responseWindowMs = (row: typeof webRow) => new Date(row!.response_due_at!).getTime() - new Date(row!.created_at!).getTime()
    const resolutionWindowMs = (row: typeof webRow) => new Date(row!.resolution_due_at!).getTime() - new Date(row!.created_at!).getTime()
    expect(webRow?.response_due_at).toBeTruthy()
    expect(waRow?.response_due_at).toBeTruthy()
    expect(Math.abs(responseWindowMs(waRow) - responseWindowMs(webRow))).toBeLessThan(5000)
    expect(Math.abs(resolutionWindowMs(waRow) - resolutionWindowMs(webRow))).toBeLessThan(5000)

    // Everything above is identical between channels, except the recorded
    // origin: createRequestCore() stamps source_metadata.created_via so a
    // technician can tell a WhatsApp ticket from a web one.
    expect((webRow?.source_metadata as { created_via?: string } | null)?.created_via).toBe('portal')
    expect((waRow?.source_metadata as { created_via?: string } | null)?.created_via).toBe('whatsapp')
  })
})
