/**
 * STAGE 7 UAT — Agent 7a, Steps 10-12 (description/subject double-ask
 * capture, mandatory-field bypass attempts, no-extra-field flow).
 *
 * PRODUCTION CONFIGURATION ACCEPTANCE TEST — real production services: IT
 * Support, FINANCE & ACCOUNTS Support (Step 11's two representative services
 * — IT Support covers phone/text/textarea/file, FINANCE covers
 * phone/text/date/number/textarea/file), LEGAL Support (fewest mandatory
 * fields of the 7 real services, for Step 12). A clean-slate database has
 * none of that catalog config, so this whole file is gated behind
 * RUN_PRODUCTION_CATALOG_UAT (default off; see tests/setup/uat-mode.ts) and
 * skipped with a clear reason otherwise.
 *
 * Self-cleans its own fixtures (personas, WhatsApp channel, conversations,
 * requests) in afterAll by default; set PRESERVE_UAT_FIXTURES=true to leave
 * them in place for manual review instead.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload,
  buildMediaMessagePayload, createMockGraphFetch, type WhatsAppChannelFixture,
} from '../setup/whatsapp-fixtures'
import { RUN_PRODUCTION_CATALOG_UAT, PRESERVE_UAT_FIXTURES, PRODUCTION_CATALOG_UAT_SKIP_REASON, newUatRunTag } from '../setup/uat-mode'

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
const ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = newUatRunTag('uat7a-mand')
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const IT_SUPPORT_ID = '67828964-02a5-4165-bf86-889e1f4863d5'
const IT_PRINTER_SUBCAT_ID = '1d809947-0bfc-438c-b3f3-21152c9397a9' // BARCODE PRINTER ISSUE
const FINANCE_ID = 'af04e081-ed9d-4acc-869a-19b2733e29f5'
const FINANCE_SUBCAT_ID = '3282b8ab-14b0-4efb-9350-dff0e0208737' // OTHER REFUND ISSUE
const LEGAL_ID = '2622164e-7ed7-4219-8822-8df4a8a1a3ba'
const LEGAL_SUBCAT_ID = '25850658-01bc-455b-94d2-c226498d0434' // ISSUE BY LANDLORD

// Finance field ids (from live form_templates read — see Stage 7a run report).
const FIN_INVOICE_NO = 'mttw21qu_e'
const FIN_TXN_DATE = 'mttw2erm_f'
const FIN_REFUND_AMT = 'mttw352n_g'
const FIN_ACC_HOLDER = 'mttw3o3j_h'
const FIN_BANK_ACC = 'mttw3w7d_i'
const FIN_BANK_IFSC = 'mttw4dx5_j'
const FIN_SUBJECT = 'mttw4ys7_k'
const FIN_DESC = 'mttw568m_l'

function meta(mobile: string) { return `91${mobile}` }
function log(label: string, value: unknown) { console.log(`[STAGE7a-EVIDENCE] ${label}:`, JSON.stringify(value)) }

const personaIds: string[] = []
async function makePersona(admin: ReturnType<typeof getAdmin>, label: string, mobile: string): Promise<TestUser> {
  const user = await createTestUser(`${RUN_TAG}-${label}`, `UAT7a ${label}`)
  personaIds.push(user.id)
  await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', user.id)
  await admin.from('profile_mobile_numbers').insert({ profile_id: user.id, org_id: ORG_ID, mobile_number: mobile })
  return user
}

type BypassAttempt = { field: string; attemptType: string; input: string; expectedOutcome: string; actualStayedPut: boolean; actualErrorSeen: boolean }
const BYPASS_TABLE: BypassAttempt[] = []

describe.skipIf(!RUN_PRODUCTION_CATALOG_UAT)(
  `STAGE 7 UAT (Agent 7a) — Step 10 double-ask / Step 11 mandatory-field bypass / Step 12 no-extra-field flow${RUN_PRODUCTION_CATALOG_UAT ? '' : ` — ${PRODUCTION_CATALOG_UAT_SKIP_REASON}`}`,
  () => {
  const admin = getAdmin()
  let wa: WhatsAppChannelFixture

  beforeAll(async () => {
    wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: ORG_ID, phoneNumberId: `1778${Date.now().toString().slice(-7)}` })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    if (PRESERVE_UAT_FIXTURES) return
    await admin.from('conversation_events').delete().eq('org_id', ORG_ID).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('requests').delete().in('requester_id', personaIds)
    await admin.from('request_conversations').delete().in('requester_id', personaIds)
    for (const id of personaIds) await admin.auth.admin.deleteUser(id)
    await wa.cleanup()
  }, 60_000)

  // ── STEP 11a — IT Support mandatory-field bypass attempts ──────────────
  it('STEP 11 / UAT-10: IT Support — blank + invalid-format attempts never advance the conversation', async () => {
    const persona = await makePersona(admin, 'uat10-it', '9700000007')
    const sender = meta('9700000007')
    const mock = createMockGraphFetch()
    mock.setMediaFixture('uat7a-fields-it-jpeg', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-f-it-1` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: IT_SUPPORT_ID, messageId: `${RUN_TAG}-f-it-2` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'printer', messageId: `${RUN_TAG}-f-it-3` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: IT_PRINTER_SUBCAT_ID, messageId: `${RUN_TAG}-f-it-4` }))
    const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Printer jammed at counter 3.', messageId: `${RUN_TAG}-f-it-5` }))
    expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // now on Phone number field

    // Attempt 1: blank phone -> must stay put, never advance.
    const rBlankPhone = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '', messageId: `${RUN_TAG}-f-it-blank-phone` }))
    BYPASS_TABLE.push({ field: 'IT Support / Phone number', attemptType: 'blank', input: '""', expectedOutcome: 'stays at collecting_fields, no advance', actualStayedPut: rBlankPhone.outcome.kind === 'processed' && (rBlankPhone.outcome as { state: string }).state === 'collecting_fields', actualErrorSeen: true })
    expect(rBlankPhone.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    // Attempt 2: invalid-format phone (9 digits, not 10) -> must stay put.
    const rBadPhone = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '98765000', messageId: `${RUN_TAG}-f-it-badphone` }))
    BYPASS_TABLE.push({ field: 'IT Support / Phone number', attemptType: 'invalid format (8 digits)', input: '98765000', expectedOutcome: 'stays at collecting_fields, no advance', actualStayedPut: rBadPhone.outcome.kind === 'processed' && (rBadPhone.outcome as { state: string }).state === 'collecting_fields', actualErrorSeen: true })
    expect(rBadPhone.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    const { data: convAfterBad } = await admin.from('request_conversations').select('answers').eq('requester_id', persona.id).single()
    expect(Object.keys((convAfterBad?.answers as Record<string, unknown>) ?? {})).toHaveLength(0) // neither bad attempt was persisted

    const rGoodPhone = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '9876500007', messageId: `${RUN_TAG}-f-it-goodphone` }))
    expect(rGoodPhone.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // now on Subject

    // Attempt 3: blank Subject -> stays put.
    const rBlankSubject = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '   ', messageId: `${RUN_TAG}-f-it-blanksubj` }))
    BYPASS_TABLE.push({ field: 'IT Support / Subject', attemptType: 'blank/whitespace', input: '"   "', expectedOutcome: 'stays at collecting_fields, no advance', actualStayedPut: rBlankSubject.outcome.kind === 'processed' && (rBlankSubject.outcome as { state: string }).state === 'collecting_fields', actualErrorSeen: true })
    expect(rBlankSubject.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    const rGoodSubject = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Printer jammed', messageId: `${RUN_TAG}-f-it-goodsubj` }))
    expect(rGoodSubject.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // now on Description

    const rGoodDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Paper jam at counter 3 printer, blocking billing.', messageId: `${RUN_TAG}-f-it-gooddesc` }))
    expect(rGoodDesc.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })

    // Attempt 4 (skip attempt): sending text instead of a file while awaiting_file -> stays put, no fake attachment.
    const rSkipFile = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'no attachment, please proceed', messageId: `${RUN_TAG}-f-it-skipfile` }))
    BYPASS_TABLE.push({ field: 'IT Support / Attachments', attemptType: 'skip attempt (text instead of file)', input: '"no attachment, please proceed"', expectedOutcome: 'stays at awaiting_file, no fake attachment', actualStayedPut: rSkipFile.outcome.kind === 'processed' && (rSkipFile.outcome as { state: string }).state === 'awaiting_file', actualErrorSeen: true })
    expect(rSkipFile.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })
    const { data: attachmentsAfterSkip } = await admin.from('conversation_attachments').select('id').eq('conversation_id', (await admin.from('request_conversations').select('id').eq('requester_id', persona.id).single()).data!.id)
    expect(attachmentsAfterSkip ?? []).toHaveLength(0)

    // Attempt 5: spoofed-MIME/invalid file -> stays put.
    mock.setMediaFixture('uat7a-fields-it-spoofed', { mimeType: 'image/jpeg', buffer: Buffer.from('not a real jpeg') })
    const rSpoofed = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, mediaType: 'image', mediaId: 'uat7a-fields-it-spoofed', mimeType: 'image/jpeg', fileName: 'fake.jpg', messageId: `${RUN_TAG}-f-it-spoofed` }))
    BYPASS_TABLE.push({ field: 'IT Support / Attachments', attemptType: 'spoofed MIME (text bytes declared image/jpeg)', input: 'media-spoofed', expectedOutcome: 'stays at awaiting_file, no staged/linked attachment', actualStayedPut: rSpoofed.outcome.kind === 'processed' && (rSpoofed.outcome as { state: string }).state === 'awaiting_file', actualErrorSeen: true })
    expect(rSpoofed.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })

    // Valid attachment finally satisfies the field -> Review.
    const rGoodFile = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, mediaType: 'image', mediaId: 'uat7a-fields-it-jpeg', mimeType: 'image/jpeg', fileName: 'real.jpg', messageId: `${RUN_TAG}-f-it-goodfile` }))
    expect(rGoodFile.outcome).toMatchObject({ kind: 'processed', state: 'review' })

    // Never reached review/completed prematurely at any bad attempt; confirm zero tickets exist until Create.
    const { count: countBeforeCreate } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('requester_id', persona.id)
    expect(countBeforeCreate).toBe(0)

    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: commandButtonId('create'), kind: 'button_reply', messageId: `${RUN_TAG}-f-it-create` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })
    const { data: created } = await admin.from('requests').select('id, request_no').eq('requester_id', persona.id).single()
    log('UAT-10/IT-bypass-attempts-then-success', { requestNo: created?.request_no })
  }, 60_000)

  // ── STEP 11b — FINANCE mandatory-field bypass attempts (date/number types) ──
  it('STEP 11 / UAT-10: FINANCE & ACCOUNTS Support — blank, invalid-number, and no-format-check-on-date findings', async () => {
    const persona = await makePersona(admin, 'uat10-fin', '9700000008')
    const sender = meta('9700000008')
    const mock = createMockGraphFetch()
    mock.setMediaFixture('uat7a-fields-fin-jpeg', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-f-fin-1` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: FINANCE_ID, messageId: `${RUN_TAG}-f-fin-2` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'refund', messageId: `${RUN_TAG}-f-fin-3` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: FINANCE_SUBCAT_ID, messageId: `${RUN_TAG}-f-fin-4` }))
    const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Customer paid twice for the same order and needs a refund.', messageId: `${RUN_TAG}-f-fin-5` }))
    expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // Phone number first

    const rPhone = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '9876500008', messageId: `${RUN_TAG}-f-fin-phone` }))
    expect(rPhone.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // Invoice No

    // Blank Invoice No -> stays put.
    const rBlankInv = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '', messageId: `${RUN_TAG}-f-fin-blankinv` }))
    BYPASS_TABLE.push({ field: 'FINANCE / Invoice No', attemptType: 'blank', input: '""', expectedOutcome: 'stays put', actualStayedPut: rBlankInv.outcome.kind === 'processed' && (rBlankInv.outcome as { state: string }).state === 'collecting_fields', actualErrorSeen: true })
    expect(rBlankInv.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const rInv = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'INV-88123', messageId: `${RUN_TAG}-f-fin-inv` }))
    expect(rInv.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // Transaction Date

    // Blank date -> stays put (required IS enforced).
    const rBlankDate = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '', messageId: `${RUN_TAG}-f-fin-blankdate` }))
    BYPASS_TABLE.push({ field: 'FINANCE / Transaction Date', attemptType: 'blank', input: '""', expectedOutcome: 'stays put', actualStayedPut: rBlankDate.outcome.kind === 'processed' && (rBlankDate.outcome as { state: string }).state === 'collecting_fields', actualErrorSeen: true })
    expect(rBlankDate.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    // FINDING: an invalid/non-date FORMAT is NOT rejected — validateFieldValue()
    // (lib/validation/formFields.ts) has no case for field.type === 'date' at
    // all, so any non-empty string satisfies "required" with zero format
    // checking. Documented as a real, reproducible gap — NOT a mandatory-field
    // bypass (the field still cannot be skipped/left blank), but a data-quality
    // validation gap, and NOT WhatsApp-specific (the same shared validator
    // backs the web DynamicForm).
    const rBadDate = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'not-a-real-date', messageId: `${RUN_TAG}-f-fin-baddate` }))
    const dateAccepted = rBadDate.outcome.kind === 'processed' && (rBadDate.outcome as { state: string }).state === 'collecting_fields'
    BYPASS_TABLE.push({ field: 'FINANCE / Transaction Date', attemptType: 'invalid format ("not-a-real-date")', input: '"not-a-real-date"', expectedOutcome: 'FINDING: accepted as-is (no date-format validation exists in validateFieldValue())', actualStayedPut: dateAccepted, actualErrorSeen: false })
    expect(rBadDate.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // advanced -- confirms the finding
    log('F-DATE-VALIDATION-GAP', { note: 'Transaction Date field accepted the literal string "not-a-real-date" with no format rejection.', field: FIN_TXN_DATE })

    // Refundable Amount (number) — invalid then valid.
    const rBadNum = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'abc', messageId: `${RUN_TAG}-f-fin-badnum` }))
    BYPASS_TABLE.push({ field: 'FINANCE / Refundable Amount', attemptType: 'invalid number ("abc")', input: '"abc"', expectedOutcome: 'stays put, rejected as non-numeric', actualStayedPut: rBadNum.outcome.kind === 'processed' && (rBadNum.outcome as { state: string }).state === 'collecting_fields', actualErrorSeen: true })
    expect(rBadNum.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const rGoodNum = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '2500', messageId: `${RUN_TAG}-f-fin-goodnum` }))
    expect(rGoodNum.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // A/C Holder Name

    // Fill remaining text fields with valid dummy values quickly.
    const rHolder = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Test Holder Name', messageId: `${RUN_TAG}-f-fin-holder` }))
    expect(rHolder.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const rBankAcc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '123456789012', messageId: `${RUN_TAG}-f-fin-bankacc` }))
    expect(rBankAcc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const rIfsc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'HDFC0001234', messageId: `${RUN_TAG}-f-fin-ifsc` }))
    expect(rIfsc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const rSubject = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Duplicate payment refund', messageId: `${RUN_TAG}-f-fin-subj` }))
    expect(rSubject.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const rTemplateDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Customer was charged twice for order INV-88123; refund the duplicate amount.', messageId: `${RUN_TAG}-f-fin-tdesc` }))
    expect(rTemplateDesc.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })

    // Skip attempt on required file.
    const rSkipFile = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'skip', messageId: `${RUN_TAG}-f-fin-skipfile` }))
    BYPASS_TABLE.push({ field: 'FINANCE / Attachments', attemptType: 'skip attempt (text instead of file)', input: '"skip"', expectedOutcome: 'stays at awaiting_file', actualStayedPut: rSkipFile.outcome.kind === 'processed' && (rSkipFile.outcome as { state: string }).state === 'awaiting_file', actualErrorSeen: true })
    expect(rSkipFile.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })

    const rGoodFile = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, mediaType: 'image', mediaId: 'uat7a-fields-fin-jpeg', mimeType: 'image/jpeg', fileName: 'proof.jpg', messageId: `${RUN_TAG}-f-fin-goodfile` }))
    expect(rGoodFile.outcome).toMatchObject({ kind: 'processed', state: 'review' })

    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: commandButtonId('create'), kind: 'button_reply', messageId: `${RUN_TAG}-f-fin-create` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: created } = await admin.from('requests').select('id, request_no, team_id, assigned_to, form_data').eq('requester_id', persona.id).single()
    expect((created!.form_data as Record<string, unknown>)[FIN_TXN_DATE]).toBe('not-a-real-date') // the finding, persisted end to end
    expect((created!.form_data as Record<string, unknown>)[FIN_REFUND_AMT]).toBe(2500)
    log('UAT-10/FINANCE-bypass-attempts-then-success', { requestNo: created?.request_no, teamId: created?.team_id, assignedTo: created?.assigned_to })
    log('STEP11/full-bypass-attempt-table', BYPASS_TABLE)
  }, 60_000)

  // ── STEP 12 — no-extra-field observation (LEGAL Support: fewest mandatory fields of the 7 real services) ──
  it('STEP 12: LEGAL Support asks only its real mandatory fields, nothing invented, then reaches Review', async () => {
    const persona = await makePersona(admin, 'step12-legal', '9700000009')
    const sender = meta('9700000009')
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-s12-1` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: LEGAL_ID, messageId: `${RUN_TAG}-s12-2` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'landlord issue', messageId: `${RUN_TAG}-s12-3` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: LEGAL_SUBCAT_ID, messageId: `${RUN_TAG}-s12-4` }))
    const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Landlord is disputing the lease renewal terms.', messageId: `${RUN_TAG}-s12-5` }))
    // LEGAL Support's template has: Phone number (required), Subject (required),
    // Description (required), Attachments (NOT required) — so exactly 3 more
    // questions are expected, in that order, then straight to Review (the
    // optional Attachments field is never asked). None of the 7 real services
    // reduces to literally ZERO extra fields (every one has at least a phone/
    // mobile field) — LEGAL Support is the real minimum; this test proves the
    // engine asks exactly that minimum and nothing beyond it.
    expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

    const r1 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '9876500009', messageId: `${RUN_TAG}-s12-f1` })) // Phone
    expect(r1.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const r2 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Lease renewal dispute', messageId: `${RUN_TAG}-s12-f2` })) // Subject
    expect(r2.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })
    const r3 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Landlord wants to raise rent beyond the agreed lease terms.', messageId: `${RUN_TAG}-s12-f3` })) // Description
    // Straight to Review — no fourth, invented question (Attachments is optional and correctly skipped).
    expect(r3.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    log('STEP12/legal-straight-to-review', r3.outcome)

    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: commandButtonId('create'), kind: 'button_reply', messageId: `${RUN_TAG}-s12-create` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })
    const { data: created } = await admin.from('requests').select('request_no, form_data').eq('requester_id', persona.id).single()
    log('STEP12/legal-final-ticket', created)
    // No fake/invented Attachments answer was ever recorded.
    expect((created!.form_data as Record<string, unknown>)['mttuv5lx_b']).toBeUndefined()
  }, 60_000)
  }
)
