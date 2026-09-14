/**
 * Stage 7 UAT (Steps 16-18 of the Stage 7B execution brief) — UAT-16
 * (web/WhatsApp parity on a real production service), UAT-19 (SLA parity),
 * and UAT-18 (assignment / business-rules routing through the real staffed
 * IT Support and HR Support teams, plus one isolated, clearly-tagged UAT
 * business rule proving the rule engine is genuinely CAPABLE of firing
 * through the real WhatsApp path even though assignment_rules is empty and
 * the org's 4 real business_rules are all dead against deleted categories
 * (Stage 6 Findings 3/4 — pre-existing config gaps, not WhatsApp defects)).
 *
 * Real production services are used (IT Support / HR Support — the only 2
 * of 7 real services with a staffed default team, per Stage 6 Finding 5).
 * No real production config is mutated: the one UAT business rule created
 * here is scoped to a brand-new, clearly-tagged fixture sub-category
 * (`uat7b-...`) attached to IT Support, not to any of IT Support's real
 * sub-categories, and the one team_members row added for the test agent is
 * removed in afterAll. IT Support / HR Support themselves, their real
 * sub-categories, and their real staffed teams are never modified.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, buildMediaMessagePayload,
  createMockGraphFetch, type WhatsAppChannelFixture,
} from '../setup/whatsapp-fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'
import { commandButtonId } from '@/lib/whatsapp/types'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `uat7b-8c5d02-parity-${Date.now()}`

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const IT_SERVICE_ID = '67828964-02a5-4165-bf86-889e1f4863d5'
const IT_TEAM_ID = '20000000-0000-0000-0000-000000000001'
// IT Support template field order (for reference): phone(mtbft8s0_1),
// subject(mtiddwhc_1), description(mtbftqh9_3), attachments(mtbftesy_2) —
// answered positionally below via plain text/media messages.
const IT_VPN_SUBCATEGORY_ID = '7ba338c3-8e7c-4afb-a099-51f76c078158' // real "VPN CREATION"

const HR_SERVICE_ID = 'd7e3feb4-e160-4565-bc6b-b273105f9710'
const HR_TEAM_ID = '20000000-0000-0000-0000-000000000002'
const HR_MOBILE_FIELD = 'msn0hkgn_1'
const HR_SUBJECT_FIELD = 'mtifkdwo_1'
const HR_DESCRIPTION_FIELD = 'mtifkrsk_2'
const HR_GRATUITY_SUBCATEGORY_ID = '0be6c31c-2b7f-4e03-9bb9-2bbcfcc308f7' // real "GRATUITY"

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

describe('Stage 7B — UAT-16 / UAT-19: web vs WhatsApp parity + SLA on a real production service (HR Support)', () => {
  let wa: WhatsAppChannelFixture
  let webRequester: TestUser
  let waRequester: TestUser
  const admin = getAdmin()
  const sender = '9700100001'

  beforeAll(async () => {
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: ORG_ID, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    ;[webRequester, waRequester] = await Promise.all([
      createTestUser('uat7b-parity-web', 'UAT7B Parity Web Requester'),
      createTestUser('uat7b-parity-wa', 'UAT7B Parity WA Requester'),
    ])
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', waRequester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', ORG_ID).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', waRequester.id)
    await admin.from('requests').delete().eq('requester_id', webRequester.id)
    await admin.from('requests').delete().eq('requester_id', waRequester.id)
    for (const u of [webRequester, waRequester]) await admin.auth.admin.deleteUser(u.id)
    await wa.cleanup()
  }, 60_000)

  it('UAT-16 / UAT-19: an HR Support ticket created via WhatsApp matches an equivalent web-created ticket on every business-derived field, including SLA window', async () => {
    const answers = {
      [HR_MOBILE_FIELD]: '9812345670',
      [HR_SUBJECT_FIELD]: `UAT7B Parity Subject ${RUN_TAG}`,
      [HR_DESCRIPTION_FIELD]: 'Gratuity settlement query for a resigned employee.',
    }

    // ── Web path: direct createRequestCore() call, source:'web' ────────────
    const webResult = await createRequestCore({
      client: admin as never,
      orgId: ORG_ID,
      requesterId: webRequester.id,
      actingUserId: webRequester.id,
      serviceId: HR_SERVICE_ID,
      subCategoryId: HR_GRATUITY_SUBCATEGORY_ID,
      formData: answers,
      source: 'web',
      useAdminForWrites: true,
    })
    expect(webResult.error).toBeUndefined()
    expect(webResult.requestId).toBeTruthy()

    // ── WhatsApp path: the same selections through the real webhook pipeline ──
    const mock = createMockGraphFetch()
    const senderMeta = `91${sender}`
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: HR_SERVICE_ID, runTag: RUN_TAG }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'gratuity', runTag: RUN_TAG }))
    const rSubcat = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: HR_GRATUITY_SUBCATEGORY_ID, runTag: RUN_TAG }))
    expect(rSubcat.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })
    const waDescriptionText = 'Gratuity settlement query for a resigned employee.'
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: waDescriptionText, runTag: RUN_TAG }))
    // Stage 7.1: Subject/Description are now semantic_role-mapped on the real
    // HR Support Template — auto-filled from the title/description just
    // captured above, never asked again. Template field order: Mobile
    // Number(0), Subject(1, auto-filled), Description(2, auto-filled),
    // Attachments(3, optional -> skipped) — only Mobile Number is actually
    // asked now.
    const rLastField = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: answers[HR_MOBILE_FIELD], runTag: RUN_TAG }))
    expect(rLastField.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    const waCreateResult = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
    expect(waCreateResult.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: waRequests } = await admin.from('requests').select('id').eq('requester_id', waRequester.id)
    expect(waRequests).toHaveLength(1)
    const waRequestId = waRequests![0].id

    const cols = 'org_id, service_id, category_id, sub_category_id, team_id, priority, status, assigned_to, form_data, created_at, response_due_at, resolution_due_at, request_no'
    const { data: webRow } = await admin.from('requests').select(cols).eq('id', webResult.requestId!).single()
    const { data: waRow } = await admin.from('requests').select(cols).eq('id', waRequestId).single()

    // UAT-16 — business-derived fields identical across channels.
    expect(waRow?.org_id).toBe(webRow?.org_id)
    expect(waRow?.service_id).toBe(webRow?.service_id)
    expect(waRow?.service_id).toBe(HR_SERVICE_ID)
    expect(waRow?.category_id).toBe(webRow?.category_id)
    expect(waRow?.sub_category_id).toBe(webRow?.sub_category_id)
    expect(waRow?.sub_category_id).toBe(HR_GRATUITY_SUBCATEGORY_ID)
    expect(waRow?.team_id).toBe(webRow?.team_id)
    expect(waRow?.team_id).toBe(HR_TEAM_ID) // HR Support's real staffed default team
    expect(waRow?.priority).toBe(webRow?.priority)
    expect(waRow?.status).toBe(webRow?.status)
    expect(waRow?.assigned_to).toBe(webRow?.assigned_to) // both fall through to unassigned — no rule/assignment config
    expect((waRow?.form_data as Record<string, unknown>)?.[HR_MOBILE_FIELD]).toBe((webRow?.form_data as Record<string, unknown>)?.[HR_MOBILE_FIELD])
    // Stage 7.1: HR Support's Subject/Description fields are now
    // semantic_role-mapped, a CONVERSATIONAL-ENGINE-ONLY behavior (Web
    // Compatibility requirement — the web form/createRequestCore() path has
    // no such concept and simply stores whatever raw value is passed in
    // `formData`, unaffected). So this is the one INTENTIONAL, expected
    // divergence: web keeps the literal test-typed Subject, WhatsApp's
    // Subject is auto-filled from its own generated title. Everything else
    // stays identical across channels.
    expect((webRow?.form_data as Record<string, unknown>)?.[HR_SUBJECT_FIELD]).toBe(answers[HR_SUBJECT_FIELD]) // web: unchanged, raw typed value
    expect((waRow?.form_data as Record<string, unknown>)?.[HR_SUBJECT_FIELD]).toBeTruthy() // WhatsApp: auto-filled from the generated title, not the literal above
    expect((waRow?.form_data as Record<string, unknown>)?.[HR_DESCRIPTION_FIELD]).toBe(waDescriptionText) // WhatsApp: auto-filled from the captured description
    expect((webRow?.form_data as Record<string, unknown>)?.[HR_DESCRIPTION_FIELD]).toBe(answers[HR_DESCRIPTION_FIELD]) // web: unchanged
    expect(webRow?.request_no).toMatch(/^CKSD-\d{6}$/)
    expect(waRow?.request_no).toMatch(/^CKSD-\d{6}$/)

    // UAT-19 — SLA: both derive from the same resolveSlaDeadlines()-style
    // DESK logic (HR Support's own active SLA policy); WhatsApp never
    // computes SLA itself. Compare response/resolution WINDOWS (duration
    // from each row's own created_at), not raw due-at, since the two
    // requests were created a few seconds apart.
    expect(webRow?.response_due_at).toBeTruthy()
    expect(waRow?.response_due_at).toBeTruthy()
    expect(webRow?.resolution_due_at).toBeTruthy()
    expect(waRow?.resolution_due_at).toBeTruthy()
    const windowMs = (row: typeof webRow, field: 'response_due_at' | 'resolution_due_at') =>
      new Date(row![field]!).getTime() - new Date(row!.created_at!).getTime()
    expect(Math.abs(windowMs(waRow, 'response_due_at') - windowMs(webRow, 'response_due_at'))).toBeLessThan(5000)
    expect(Math.abs(windowMs(waRow, 'resolution_due_at') - windowMs(webRow, 'resolution_due_at'))).toBeLessThan(5000)
  }, 60_000)
})

describe('Stage 7B — UAT-18: assignment/business-rules routing on real staffed teams (IT Support + HR Support)', () => {
  const admin = getAdmin()
  let wa: WhatsAppChannelFixture
  let itRequester: TestUser
  let hrRequester: TestUser
  let ruleAgent: TestUser
  let ruleCategoryId: string
  let ruleSubCategoryId: string
  let ruleId: string

  beforeAll(async () => {
    wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: ORG_ID, phoneNumberId: `1556${RUN_TAG.slice(-6)}` })
    ;[itRequester, hrRequester, ruleAgent] = await Promise.all([
      createTestUser('uat7b-assign-it', 'UAT7B Assignment IT Requester'),
      createTestUser('uat7b-assign-hr', 'UAT7B Assignment HR Requester'),
      createTestUser('uat7b-assign-agent', 'UAT7B Assignment Rule Agent'),
    ])
    await admin.from('profiles').update({ mobile_number: '9700100002', whatsapp_enabled: true, is_active: true }).eq('id', itRequester.id)
    await admin.from('profiles').update({ mobile_number: '9700100003', whatsapp_enabled: true, is_active: true }).eq('id', hrRequester.id)
    await admin.from('profiles').update({ role: 'agent' }).eq('id', ruleAgent.id)
    mockedCreateClient.mockResolvedValue(admin as never)

    // One isolated, clearly-tagged UAT-only fixture sub-category attached to
    // the REAL IT Support service (never a real sub-category, never a new
    // fixture service) — proves the Business Rules engine is genuinely
    // capable of firing through the real WhatsApp path, distinct from the
    // "falls through to default team" cases below.
    const { data: cat, error: catErr } = await admin
      .from('service_categories')
      .insert({ name: `UAT7B Rule Category ${RUN_TAG}`, slug: `uat7b-rule-category-${RUN_TAG}`, org_id: ORG_ID })
      .select('id').single()
    if (catErr || !cat) throw new Error(`[uat7b] category: ${catErr?.message}`)
    ruleCategoryId = cat.id

    const { data: subcat, error: subcatErr } = await admin
      .from('service_sub_categories')
      .insert({ name: `UAT7B Rule SubCategory ${RUN_TAG}`, slug: `uat7b-rule-subcat-${RUN_TAG}`, category_id: ruleCategoryId, is_active: true, sla_priority: 'high' })
      .select('id').single()
    if (subcatErr || !subcat) throw new Error(`[uat7b] sub-category: ${subcatErr?.message}`)
    ruleSubCategoryId = subcat.id

    const { error: tagErr } = await admin.from('service_sub_category_tags').insert({ service_id: IT_SERVICE_ID, sub_category_id: ruleSubCategoryId })
    if (tagErr) throw new Error(`[uat7b] tag: ${tagErr.message}`)

    // Rule agent must be a member of IT Support's real team for the "assign"
    // action to accept them (rule engine skips non-team-members).
    await admin.from('team_members').insert({ team_id: IT_TEAM_ID, user_id: ruleAgent.id, org_id: ORG_ID })

    const { data: rule, error: ruleErr } = await admin
      .from('business_rules')
      .insert({
        org_id: ORG_ID,
        name: `UAT7B Business Rule (sub_category_id=fixture) ${RUN_TAG}`,
        trigger: ['created'],
        conditions: [{ field: 'sub_category_id', operator: 'equals', value: ruleSubCategoryId }],
        actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [ruleAgent.id] } }],
        execution_order: 0,
      })
      .select('id').single()
    if (ruleErr || !rule) throw new Error(`[uat7b] rule: ${ruleErr?.message}`)
    ruleId = rule.id
    console.log('[UAT-18c evidence] UAT-only business rule id (left for centralized Stage 7 cleanup):', ruleId, 'fixture sub-category id:', ruleSubCategoryId)
  }, 60_000)

  afterAll(async () => {
    // NOTE per Stage 7 brief: this UAT-only business rule + fixture
    // sub-category is intentionally NOT deleted here — left for the
    // centralized final Stage 7 cleanup pass, documented in the run report.
    // Only the requester/agent test users and their conversations/requests
    // (this test's own fixtures) and the team_members row added above are
    // cleaned up now.
    await admin.from('team_members').delete().eq('team_id', IT_TEAM_ID).eq('user_id', ruleAgent.id)
    await admin.from('conversation_events').delete().eq('org_id', ORG_ID).ilike('external_message_id', `%${RUN_TAG}-b%`)
    await admin.from('request_conversations').delete().in('requester_id', [itRequester.id, hrRequester.id])
    await admin.from('requests').delete().in('requester_id', [itRequester.id, hrRequester.id])
    for (const u of [itRequester, hrRequester, ruleAgent]) await admin.auth.admin.deleteUser(u.id)
    await wa.cleanup()
  }, 60_000)

  it('UAT-18a: a WhatsApp ticket on IT Support (real sub-category, real staffed team) falls through to IT Support\'s default team — no assignment_rules configured org-wide (expected-given-config, not a defect)', async () => {
    const mock = createMockGraphFetch()
    mock.setMediaFixture('uat7b-it-media', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
    const senderMeta = '919700100002'
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: `${RUN_TAG}-b` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: IT_SERVICE_ID, runTag: `${RUN_TAG}-b` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'vpn', runTag: `${RUN_TAG}-b` }))
    const rSubcat = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: IT_VPN_SUBCATEGORY_ID, runTag: `${RUN_TAG}-b` }))
    expect(rSubcat.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Need VPN access for remote work.', runTag: `${RUN_TAG}-b` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: '9812345671', runTag: `${RUN_TAG}-b` })) // phone
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: `UAT7B IT Subject ${RUN_TAG}`, runTag: `${RUN_TAG}-b` })) // subject
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Description for VPN access request.', runTag: `${RUN_TAG}-b` })) // description
    const rFile = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'uat7b-it-media', mimeType: 'image/jpeg', fileName: 'proof.jpg', runTag: `${RUN_TAG}-b` }))
    expect(rFile.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: `${RUN_TAG}-b` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: requests } = await admin.from('requests').select('id, team_id, assigned_to').eq('requester_id', itRequester.id)
    expect(requests).toHaveLength(1)
    expect(requests![0].team_id).toBe(IT_TEAM_ID)
    expect(requests![0].assigned_to).toBeNull() // no business rule matches IT Support's real sub-categories; falls through to default team, unassigned
  }, 60_000)

  it('UAT-18b: a WhatsApp ticket on HR Support (real sub-category, real staffed team) falls through to HR Support\'s default team — same expected-given-config outcome', async () => {
    const mock = createMockGraphFetch()
    const senderMeta = '919700100003'
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: `${RUN_TAG}-b2` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: HR_SERVICE_ID, runTag: `${RUN_TAG}-b2` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'gratuity', runTag: `${RUN_TAG}-b2` }))
    const rSubcat = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: HR_GRATUITY_SUBCATEGORY_ID, runTag: `${RUN_TAG}-b2` }))
    expect(rSubcat.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Gratuity query.', runTag: `${RUN_TAG}-b2` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: '9812345672', runTag: `${RUN_TAG}-b2` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: `UAT7B HR Subject ${RUN_TAG}`, runTag: `${RUN_TAG}-b2` }))
    const rLast = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Description for gratuity query.', runTag: `${RUN_TAG}-b2` }))
    expect(rLast.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: `${RUN_TAG}-b2` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: requests } = await admin.from('requests').select('id, team_id, assigned_to').eq('requester_id', hrRequester.id)
    expect(requests).toHaveLength(1)
    expect(requests![0].team_id).toBe(HR_TEAM_ID)
    expect(requests![0].assigned_to).toBeNull()
  }, 60_000)

  it('UAT-18c (business-rule capability proof): a WhatsApp ticket on IT Support in the isolated UAT fixture sub-category IS assigned by the one UAT business rule — proves the engine genuinely evaluates real WhatsApp-produced fields, not that production routing is configured', async () => {
    const mock = createMockGraphFetch()
    mock.setMediaFixture('uat7b-rule-media', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
    const ruleRequester = await createTestUser('uat7b-assign-rule-req', 'UAT7B Assignment Rule Requester')
    await admin.from('profiles').update({ mobile_number: '9700100004', whatsapp_enabled: true, is_active: true }).eq('id', ruleRequester.id)
    const senderMeta = '919700100004'
    const send = async (rawBody: string) =>
      processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    try {
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: `${RUN_TAG}-b3` }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: IT_SERVICE_ID, runTag: `${RUN_TAG}-b3` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'UAT7B Rule', runTag: `${RUN_TAG}-b3` }))
      const rSubcat = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: ruleSubCategoryId, runTag: `${RUN_TAG}-b3` }))
      expect(rSubcat.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Testing UAT business rule routing.', runTag: `${RUN_TAG}-b3` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: '9812345673', runTag: `${RUN_TAG}-b3` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: `UAT7B Rule Subject ${RUN_TAG}`, runTag: `${RUN_TAG}-b3` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Description for rule-routing proof.', runTag: `${RUN_TAG}-b3` }))
      const rFile = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, mediaType: 'image', mediaId: 'uat7b-rule-media', mimeType: 'image/jpeg', fileName: 'proof.jpg', runTag: `${RUN_TAG}-b3` }))
      expect(rFile.outcome).toMatchObject({ kind: 'processed', state: 'review' })
      const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: `${RUN_TAG}-b3` }))
      expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

      const { data: requests } = await admin.from('requests').select('id, sub_category_id, team_id, assigned_to').eq('requester_id', ruleRequester.id)
      expect(requests).toHaveLength(1)
      expect(requests![0].sub_category_id).toBe(ruleSubCategoryId)
      expect(requests![0].assigned_to).toBe(ruleAgent.id) // the UAT rule fired for real, through the real WhatsApp path
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', ORG_ID).ilike('external_message_id', `%${RUN_TAG}-b3%`)
      await admin.from('request_conversations').delete().eq('requester_id', ruleRequester.id)
      await admin.from('requests').delete().eq('requester_id', ruleRequester.id)
      await admin.auth.admin.deleteUser(ruleRequester.id)
    }
  }, 60_000)
})
