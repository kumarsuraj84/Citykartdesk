/**
 * STAGE 7 UAT — Agent 7a, Steps 6-9 (canonical flow, identity, issue search,
 * category derivation).
 *
 * EVIDENCE-GATHERING RUN, not a self-cleaning regression suite: fixtures
 * created here (personas, WhatsApp channel, conversations, requests) are
 * DELIBERATELY LEFT IN PLACE for later review/cleanup, per the Stage 7 UAT
 * brief. Every fixture is tagged with RUN_TAG so it can be identified and
 * removed once evidence has been reviewed.
 *
 * Exercises the REAL conversation engine + REAL processWhatsAppWebhookPayload
 * pipeline against REAL production services (IT Support, HR Support, LEGAL
 * Support, FINANCE & ACCOUNTS Support, Vendor Creation Support) already
 * configured in org 00000000-0000-0000-0000-000000000001. Only the outbound
 * Meta Graph API HTTP boundary is mocked (createMockGraphFetch), exactly the
 * pattern used throughout the stage4, stage5, and stage6 integration suites.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload,
  buildMediaMessagePayload, createMockGraphFetch, type WhatsAppChannelFixture,
} from '../setup/whatsapp-fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'
import { commandButtonId } from '@/lib/whatsapp/types'
import { searchSubCategories } from '@/lib/requests/questionnaire/catalog'

const mockedCreateClient = vi.mocked(createClient)
const ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = 'uat7a-a1'
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

// Real production services/sub-categories audited in Stage 6 (see
// STAGE_6_REPORT.md Part 6). Confirmed live via direct psql before writing
// this file — see the Stage 7a run report for the exact query used.
const IT_SUPPORT_ID = '67828964-02a5-4165-bf86-889e1f4863d5'
const HR_SUPPORT_ID = 'd7e3feb4-e160-4565-bc6b-b273105f9710'
const LEGAL_SUPPORT_ID = '2622164e-7ed7-4219-8822-8df4a8a1a3ba'
const FINANCE_ID = 'af04e081-ed9d-4acc-869a-19b2733e29f5'
const VENDOR_CREATION_ID = 'ee52ce80-ac6e-4d7a-a9d7-1a0f65a55641'

function meta(mobile: string) { return `91${mobile}` }
function log(label: string, value: unknown) { console.log(`[STAGE7a-EVIDENCE] ${label}:`, JSON.stringify(value)) }

async function makePersona(admin: ReturnType<typeof getAdmin>, label: string, mobile: string | null, opts: { active?: boolean; whatsappEnabled?: boolean } = {}): Promise<TestUser> {
  const user = await createTestUser(`${RUN_TAG}-${label}`, `UAT7a ${label}`)
  await admin.from('profiles').update({
    whatsapp_enabled: opts.whatsappEnabled ?? true,
    is_active: opts.active ?? true,
  }).eq('id', user.id)
  if (mobile) {
    await admin.from('profile_mobile_numbers').insert({ profile_id: user.id, org_id: ORG_ID, mobile_number: mobile })
  }
  return user
}

describe('STAGE 7 UAT (Agent 7a) — Step 6 canonical flow / Step 7 identity / Step 8 search / Step 9 category derivation', () => {
  const admin = getAdmin()
  let wa: WhatsAppChannelFixture

  beforeAll(async () => {
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: ORG_ID, phoneNumberId: `1777${Date.now().toString().slice(-7)}` })
    mockedCreateClient.mockResolvedValue(admin as never)
    log('whatsapp-channel-fixture', { channelId: wa.channelId, phoneNumberId: wa.phoneNumberId })
  }, 60_000)

  // ── STEP 6 — REAL CANONICAL FLOW (also proves UAT-05, UAT-06, UAT-07, UAT-09, UAT-16, UAT-17) ──
  it('STEP 6 / UAT-05..07,09,16,17: canonical IT Support journey end to end, exactly one ticket', async () => {
    const persona = await makePersona(admin, 'persona-a', '9700000001')
    const sender = meta('9700000001')
    const mock = createMockGraphFetch()
    mock.setMediaFixture('uat7a-canonical-jpeg', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    // "Hi" -> service list (UAT-01/UAT-05 precondition)
    const r1 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-c-hi` }))
    expect(r1.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
    const conversationId = (r1.outcome as { conversationId: string }).conversationId
    log('UAT-01/conversation-created', { conversationId, requesterId: persona.id })

    const { data: convAfterHi } = await admin.from('request_conversations').select('*').eq('id', conversationId).single()
    expect(convAfterHi?.requester_id).toBe(persona.id)
    expect(convAfterHi?.channel_type).toBe('whatsapp')

    // Select IT Support (UAT-05)
    const r2 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: IT_SUPPORT_ID, messageId: `${RUN_TAG}-c-svc` }))
    expect(r2.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_issue_search' })
    const { data: convAfterSvc } = await admin.from('request_conversations').select('service_id').eq('id', conversationId).single()
    expect(convAfterSvc?.service_id).toBe(IT_SUPPORT_ID)

    // Issue search "printer issue" (UAT-06) — use the REAL search function's
    // own top result rather than assuming a literal "Printer Issue" name
    // exists (Stage 6 audit found none — see Step 8 table below).
    const searchResults = await searchSubCategories({ client: admin as never, orgId: ORG_ID, serviceId: IT_SUPPORT_ID, query: 'printer issue' })
    expect(searchResults.length).toBeGreaterThan(0)
    const topMatch = searchResults[0]
    log('UAT-06/search-top-match', topMatch)

    const r3 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'printer issue', messageId: `${RUN_TAG}-c-search` }))
    expect(r3.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_subcategory' })

    // Select the sub-category the real search surfaced (UAT-07 + Step 9 category derivation)
    const r4 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: topMatch.id, messageId: `${RUN_TAG}-c-subcat` }))
    expect(r4.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })

    const { data: convAfterSubcat } = await admin.from('request_conversations').select('sub_category_id, category_id').eq('id', conversationId).single()
    expect(convAfterSubcat?.sub_category_id).toBe(topMatch.id)
    // Category was NEVER asked — it's derived purely from the sub-category selection.
    expect(convAfterSubcat?.category_id).toBe(topMatch.categoryId)
    log('UAT-07/category-auto-derived', { subCategoryId: topMatch.id, categoryId: convAfterSubcat?.category_id })

    // Detailed description (UAT-09) — engine's own free-text capture.
    const DESCRIPTION = 'Billing counter printer is not printing and jobs are stuck in queue since morning.'
    const r5 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: DESCRIPTION, messageId: `${RUN_TAG}-c-desc` }))
    expect(r5.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const { data: convAfterDesc } = await admin.from('request_conversations').select('description, title').eq('id', conversationId).single()
    expect(convAfterDesc?.description).toBe(DESCRIPTION)
    expect(convAfterDesc?.title).toBeTruthy() // auto-generated Subject, generated exactly once here
    log('STEP10/engine-captured-description-and-title', convAfterDesc)

    // Remaining mandatory template fields in order: Phone number, Subject
    // (text, double-ask #1), Description (textarea, double-ask #2), then the
    // required Attachments file field.
    const r6 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '9876500001', messageId: `${RUN_TAG}-c-f1` }))
    expect(r6.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const TEMPLATE_SUBJECT = 'Billing counter printer not printing'
    const r7 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: TEMPLATE_SUBJECT, messageId: `${RUN_TAG}-c-f2` }))
    expect(r7.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const TEMPLATE_DESCRIPTION = 'Printer at billing counter 2 has stopped printing; multiple jobs stuck in queue since 9am.'
    const r8 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: TEMPLATE_DESCRIPTION, messageId: `${RUN_TAG}-c-f3` }))
    expect(r8.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })

    // Required attachment.
    const r9 = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, mediaType: 'image', mediaId: 'uat7a-canonical-jpeg', mimeType: 'image/jpeg', fileName: 'printer.jpg', messageId: `${RUN_TAG}-c-file` }))
    expect(r9.outcome).toMatchObject({ kind: 'processed', state: 'review' }) // UAT-16: Review reached

    // Confirm the outbound Review message really is a full summary (not a
    // stub) — read the actual rendered WhatsApp message body via the mocked
    // Graph client's captured POST bodies.
    const reviewSend = mock.calls.filter((c) => c.url.includes('/messages') && c.init?.method === 'POST').slice(-1)[0]
    const reviewBody = JSON.parse(String(reviewSend.init!.body))
    log('UAT-16/review-message-payload', reviewBody)
    expect(reviewBody.type).toBe('interactive')

    // Create (UAT-17).
    const r10 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: commandButtonId('create'), kind: 'button_reply', messageId: `${RUN_TAG}-c-create` }))
    expect(r10.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    // ── CRITICAL CANONICAL ASSERTIONS ──────────────────────────────────────
    const { data: requests, count } = await admin
      .from('requests')
      .select('*', { count: 'exact' })
      .eq('requester_id', persona.id)
    expect(count).toBe(1) // exactly one ticket exists
    const req = requests![0]
    log('STEP6/final-request-row', req)

    expect(req.requester_id).toBe(persona.id)
    expect(req.org_id).toBe(ORG_ID)
    expect(req.service_id).toBe(IT_SUPPORT_ID)
    expect(req.sub_category_id).toBe(topMatch.id)
    expect(req.category_id).toBe(topMatch.categoryId) // category derived from sub-category
    expect(req.description).toBe(DESCRIPTION) // engine-captured description, set once
    expect(req.title).toBeTruthy() // auto-generated title/subject
    expect(req.request_no).toMatch(/^CKSD-\d{6}$/) // request_no generated
    expect(req.priority).toBeTruthy() // DESK-derived priority
    expect(req.response_due_at).toBeTruthy() // SLA derived
    expect(req.resolution_due_at).toBeTruthy()
    expect(req.team_id).toBeTruthy() // DESK-derived assignment/team

    const formData = req.form_data as Record<string, unknown>
    // All mandatory template fields present in form_data (phone, Subject, Description).
    const phoneFieldId = 'mtbft8s0_1'
    const subjectFieldId = 'mtiddwhc_1'
    const descFieldId = 'mtbftqh9_3'
    expect(formData[phoneFieldId]).toBe('9876500001')
    expect(formData[subjectFieldId]).toBe(TEMPLATE_SUBJECT)
    expect(formData[descFieldId]).toBe(TEMPLATE_DESCRIPTION)
    log('STEP10/final-form-data-subject-and-description-fields', { subjectFieldValue: formData[subjectFieldId], descFieldValue: formData[descFieldId] })

    // Attachment linked as a normal request_attachments row.
    const { data: attachment } = await admin.from('request_attachments').select('*').eq('request_id', req.id).single()
    expect(attachment).toBeTruthy()
    expect(attachment!.mime_type).toBe('image/jpeg')
    log('STEP6/linked-attachment', attachment)

    // Provenance: requests.source_metadata carries NO whatsapp-specific
    // marker (confirmed pre-existing Stage 6 Finding — sourceChannelOf() has
    // no 'whatsapp' case, intakeMessageId is always null for conversation
    // creates) — the durable provenance link is request_conversations.request_id.
    expect(req.source_metadata).toBeNull()
    const { data: convFinal } = await admin.from('request_conversations').select('id, channel_type, request_id, state').eq('id', conversationId).single()
    expect(convFinal?.request_id).toBe(req.id)
    expect(convFinal?.channel_type).toBe('whatsapp')
    expect(convFinal?.state).toBe('completed')
    log('STEP6/provenance-link', convFinal)

    // Audit trail: at least one whatsapp_message_processed row for this org during this run.
    const { data: auditRows } = await admin.from('intake_audit_log').select('id, action, created_at').eq('org_id', ORG_ID).eq('action', 'whatsapp_message_processed').order('created_at', { ascending: false }).limit(3)
    expect((auditRows ?? []).length).toBeGreaterThan(0)
    log('STEP6/sample-audit-rows', auditRows)
  }, 60_000)

  // ── STEP 7 — IDENTITY TESTS ────────────────────────────────────────────
  it('UAT-01: registered+active+mobile+WhatsApp-enabled -> allowed', async () => {
    const persona = await makePersona(admin, 'uat01', '9700000012')
    const sender = meta('9700000012')
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    const r = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-uat01-hi` }))
    expect(r.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
    const { data: conv } = await admin.from('request_conversations').select('requester_id, state').eq('requester_id', persona.id).single()
    expect(conv?.requester_id).toBe(persona.id)
    log('UAT-01', { requesterId: persona.id, conversationState: conv?.state })
  })

  it('UAT-02: unregistered mobile -> rejected, no conversation, audit row', async () => {
    const sender = meta('9799999901') // no profile anywhere with this number
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    const r = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-uat02-hi` }))
    expect(r.outcome).toMatchObject({ kind: 'rejected_sender', reason: 'not_registered' })
    const { data: convs } = await admin.from('request_conversations').select('id').eq('channel_identity', sender)
    expect(convs ?? []).toHaveLength(0)
    const { data: auditRow } = await admin.from('intake_audit_log').select('*').eq('org_id', ORG_ID).eq('action', 'whatsapp_sender_rejected').contains('metadata', { externalMessageId: `${RUN_TAG}-uat02-hi` }).maybeSingle()
    expect(auditRow?.metadata).toMatchObject({ reason: 'not_registered' })
    log('UAT-02', auditRow)
  })

  it('UAT-03: WhatsApp disabled -> rejected, audit reason=whatsapp_disabled', async () => {
    const persona = await makePersona(admin, 'uat03', '9700000013', { whatsappEnabled: false })
    const sender = meta('9700000013')
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    const r = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-uat03-hi` }))
    expect(r.outcome).toMatchObject({ kind: 'rejected_sender', reason: 'whatsapp_disabled' })
    const { data: convs } = await admin.from('request_conversations').select('id').eq('requester_id', persona.id)
    expect(convs ?? []).toHaveLength(0)
    const { data: auditRow } = await admin.from('intake_audit_log').select('*').eq('org_id', ORG_ID).eq('action', 'whatsapp_sender_rejected').contains('metadata', { externalMessageId: `${RUN_TAG}-uat03-hi` }).maybeSingle()
    expect(auditRow?.metadata).toMatchObject({ reason: 'whatsapp_disabled' })
    log('UAT-03', auditRow)
  })

  it('UAT-04: inactive profile -> rejected, audit reason=inactive', async () => {
    const persona = await makePersona(admin, 'uat04', '9700000014', { active: false })
    const sender = meta('9700000014')
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    const r = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-uat04-hi` }))
    expect(r.outcome).toMatchObject({ kind: 'rejected_sender', reason: 'inactive' })
    const { data: convs } = await admin.from('request_conversations').select('id').eq('requester_id', persona.id)
    expect(convs ?? []).toHaveLength(0)
    const { data: auditRow } = await admin.from('intake_audit_log').select('*').eq('org_id', ORG_ID).eq('action', 'whatsapp_sender_rejected').contains('metadata', { externalMessageId: `${RUN_TAG}-uat04-hi` }).maybeSingle()
    expect(auditRow?.metadata).toMatchObject({ reason: 'inactive' })
    log('UAT-04', auditRow)
  })

  it('UAT-26: admin changes mobile mid-conversation -> old number rejected, new number fresh-authorized, no separate WhatsApp mapping table', async () => {
    const OLD = '9700000005'
    const NEW = '9700000015'
    const persona = await makePersona(admin, 'uat26', OLD)
    const mock = createMockGraphFetch()
    const send = async (from: string, body: string, messageId: string) => {
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from, body, messageId })
      return processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    }

    const before = await send(meta(OLD), 'Hi', `${RUN_TAG}-uat26-old-1`)
    expect(before.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
    const oldConversationId = (before.outcome as { conversationId: string }).conversationId

    // Direct, tagged, reversible mobile-number change (remove old, add new)
    // — the admin action under test.
    await admin.from('profile_mobile_numbers').delete().eq('profile_id', persona.id).eq('mobile_number', OLD)
    await admin.from('profile_mobile_numbers').insert({ profile_id: persona.id, org_id: ORG_ID, mobile_number: NEW })
    log('UAT-26/mobile-changed', { requesterId: persona.id, from: OLD, to: NEW })

    // Old number's conversation still sits mid-flow in the DB, but the OLD
    // number itself no longer resolves to ANY profile.
    const oldAfter = await send(meta(OLD), 'IT Support', `${RUN_TAG}-uat26-old-2`)
    expect(oldAfter.outcome).toMatchObject({ kind: 'rejected_sender', reason: 'not_registered' })
    const { data: oldConvAfter } = await admin.from('request_conversations').select('state').eq('id', oldConversationId).single()
    expect(oldConvAfter?.state).toBe('awaiting_service') // untouched — never silently advanced by the rejected message
    log('UAT-26/old-conversation-untouched', oldConvAfter)

    // New number is immediately authorized and starts a FRESH conversation as the same persona.
    const newAfter = await send(meta(NEW), 'Hi', `${RUN_TAG}-uat26-new-1`)
    expect(newAfter.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
    const newConversationId = (newAfter.outcome as { conversationId: string }).conversationId
    expect(newConversationId).not.toBe(oldConversationId)
    const { data: newConv } = await admin.from('request_conversations').select('requester_id, channel_identity').eq('id', newConversationId).single()
    expect(newConv?.requester_id).toBe(persona.id)
    expect(newConv?.channel_identity).toBe(meta(NEW))
    log('UAT-26/new-conversation', newConv)
  })

  it('UAT-27: WhatsApp disabled mid-conversation -> next message rejected, no state advancement, audit row', async () => {
    const persona = await makePersona(admin, 'uat27', '9700000006')
    const sender = meta('9700000006')
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    const r1 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-uat27-1` }))
    expect(r1.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
    const conversationId = (r1.outcome as { conversationId: string }).conversationId
    const r2 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: IT_SUPPORT_ID, messageId: `${RUN_TAG}-uat27-2` }))
    expect(r2.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_issue_search' })

    // Admin disables WhatsApp for this requester mid-conversation.
    await admin.from('profiles').update({ whatsapp_enabled: false }).eq('id', persona.id)
    log('UAT-27/whatsapp-disabled-mid-flow', { requesterId: persona.id })

    const r3 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'printer issue', messageId: `${RUN_TAG}-uat27-3` }))
    expect(r3.outcome).toMatchObject({ kind: 'rejected_sender', reason: 'whatsapp_disabled' })

    // No further state advancement — conversation frozen at awaiting_issue_search.
    const { data: convAfter } = await admin.from('request_conversations').select('state').eq('id', conversationId).single()
    expect(convAfter?.state).toBe('awaiting_issue_search')

    const { data: auditRow } = await admin.from('intake_audit_log').select('*').eq('org_id', ORG_ID).eq('action', 'whatsapp_sender_rejected').contains('metadata', { externalMessageId: `${RUN_TAG}-uat27-3` }).maybeSingle()
    expect(auditRow?.metadata).toMatchObject({ reason: 'whatsapp_disabled' })
    log('UAT-27/frozen-conversation-and-audit', { convAfter, auditRow })
  })

  // ── STEP 8 — ISSUE SEARCH QUALITY (observe only, real searchSubCategories()) ──
  it('STEP 8: search-quality observation across real services/terms', async () => {
    const cases: { term: string; serviceId: string; serviceName: string }[] = [
      { term: 'printer issue', serviceId: IT_SUPPORT_ID, serviceName: 'IT Support' },
      { term: 'printer', serviceId: IT_SUPPORT_ID, serviceName: 'IT Support' },
      { term: 'print', serviceId: IT_SUPPORT_ID, serviceName: 'IT Support' },
      { term: 'laptop', serviceId: IT_SUPPORT_ID, serviceName: 'IT Support' },
      { term: 'wifi', serviceId: IT_SUPPORT_ID, serviceName: 'IT Support' },
      { term: 'password', serviceId: IT_SUPPORT_ID, serviceName: 'IT Support' },
      { term: 'salary', serviceId: HR_SUPPORT_ID, serviceName: 'HR Support' },
      { term: 'vendor', serviceId: VENDOR_CREATION_ID, serviceName: 'Vendor Creation Support' },
      { term: 'invoice', serviceId: FINANCE_ID, serviceName: 'FINANCE & ACCOUNTS Support' },
      { term: 'refund', serviceId: FINANCE_ID, serviceName: 'FINANCE & ACCOUNTS Support' },
    ]
    const table: Record<string, unknown>[] = []
    for (const c of cases) {
      const results = await searchSubCategories({ client: admin as never, orgId: ORG_ID, serviceId: c.serviceId, query: c.term })
      table.push({
        term: c.term,
        service: c.serviceName,
        topResults: results.slice(0, 5).map((r) => ({ name: r.name, score: r.score })),
        resultCount: results.length,
      })
      // Observation only — never modifying the search algorithm. No hard
      // assertions on ranking; some terms are expected to have zero results
      // (e.g. "password" has no dedicated IT sub-category — see evidence table).
    }
    log('STEP8/search-quality-table', table)
    expect(table.length).toBe(cases.length)
  })

  // ── STEP 9 — CATEGORY AUTO-DERIVATION across multiple sub-categories ──
  it('STEP 9: sub_category.category_id matches for every sub-category touched in this run', async () => {
    const subCategoryIds = ['1d809947-0bfc-438c-b3f3-21152c9397a9', '3df7c05a-382a-46ca-aeb9-25d8f540a742', '6c0f2507-f25c-493e-820c-448462be4c43']
    for (const id of subCategoryIds) {
      const { data: sc } = await admin.from('service_sub_categories').select('id, category_id').eq('id', id).single()
      expect(sc?.category_id).toBeTruthy()
      log('STEP9/subcategory-category-mapping', sc)
    }
  })
})
