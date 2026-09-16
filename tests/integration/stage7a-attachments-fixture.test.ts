/**
 * STAGE 7 UAT — Agent 7a, Step 13 (required attachments: valid / invalid /
 * Review-Create with no second Meta download) plus the shared "UAT Fixture —
 * Field Types" service (UAT-12: radio / multiselect / checkbox / email field
 * types, none of which exist in real production config per Stage 6 Part 8).
 *
 * EVIDENCE-GATHERING RUN — fixtures created here are DELIBERATELY LEFT IN
 * PLACE (personas, WhatsApp channel, the fixture service/team/category/
 * sub-category, conversations, requests), tagged with RUN_TAG, for later
 * review/cleanup. The fixture service is a UAT-only artifact, clearly named,
 * NOT deactivated here per the brief (a second agent/orchestrating session
 * may still need it) — noted in the run report as pending deactivation at
 * final Stage 7 cleanup.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { createTestDepartment } from '../setup/test-department'
import {
  setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload,
  buildMediaMessagePayload, createMockGraphFetch, type WhatsAppChannelFixture,
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
import { findAttachmentsForConversation } from '@/lib/conversations'

const mockedCreateClient = vi.mocked(createClient)
const ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = 'uat7a-a1'
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const IT_SUPPORT_ID = '67828964-02a5-4165-bf86-889e1f4863d5'
const IT_PRINTER_SUBCAT_ID = '1d809947-0bfc-438c-b3f3-21152c9397a9' // BARCODE PRINTER ISSUE

function meta(mobile: string) { return `91${mobile}` }
function log(label: string, value: unknown) { console.log(`[STAGE7a-EVIDENCE] ${label}:`, JSON.stringify(value)) }

async function makePersona(admin: ReturnType<typeof getAdmin>, label: string, mobile: string): Promise<TestUser> {
  const user = await createTestUser(`${RUN_TAG}-${label}`, `UAT7a ${label}`)
  await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', user.id)
  await admin.from('profile_mobile_numbers').insert({ profile_id: user.id, org_id: ORG_ID, mobile_number: mobile })
  return user
}

describe('STAGE 7 UAT (Agent 7a) — Step 13 attachments + UAT Fixture — Field Types (UAT-12)', () => {
  const admin = getAdmin()
  let wa: WhatsAppChannelFixture

  beforeAll(async () => {
    wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-c`, orgId: ORG_ID, phoneNumberId: `1779${Date.now().toString().slice(-7)}` })
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  // ── STEP 13 — required attachments (IT Support's real mandatory file field) ──
  it('UAT-13/14/15: valid image staged before Review; invalid/oversized rejected with no staged object; Create MOVES the staged file with zero re-download from Meta', async () => {
    const persona = await makePersona(admin, 'uat13', '9700000010')
    const sender = meta('9700000010')
    const mock = createMockGraphFetch()
    mock.setMediaFixture('uat7a-att-valid', { mimeType: 'image/jpeg', buffer: JPEG_BYTES })
    mock.setMediaFixture('uat7a-att-spoofed', { mimeType: 'image/jpeg', buffer: Buffer.from('this is not a jpeg, just text') })
    mock.setMediaFixture('uat7a-att-oversized', { mimeType: 'image/jpeg', buffer: JPEG_BYTES, fileSize: 26 * 1024 * 1024 }) // declares 26MB (> 25MB cap) without downloading 26MB
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    const r1 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-att-1` }))
    const conversationId = (r1.outcome as { conversationId: string }).conversationId
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: IT_SUPPORT_ID, messageId: `${RUN_TAG}-att-2` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'printer', messageId: `${RUN_TAG}-att-3` }))
    await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: IT_PRINTER_SUBCAT_ID, messageId: `${RUN_TAG}-att-4` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Printer not printing at counter 1.', messageId: `${RUN_TAG}-att-5` }))
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '9876500010', messageId: `${RUN_TAG}-att-6` })) // phone
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Printer down counter 1', messageId: `${RUN_TAG}-att-7` })) // subject
    const rBeforeFile = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Counter 1 printer will not print any jobs since 10am.', messageId: `${RUN_TAG}-att-8` })) // description
    expect(rBeforeFile.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })

    // (b1) Spoofed MIME -> rejected, never staged, Review still blocked.
    // insertAttachment() inserts a NEW row per attempt (never upserts over a
    // prior failure) -- each attempt is looked up by its own externalMediaId,
    // not by array position, since later attempts append further rows.
    const rSpoofed = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, mediaType: 'image', mediaId: 'uat7a-att-spoofed', mimeType: 'image/jpeg', fileName: 'spoofed.jpg', messageId: `${RUN_TAG}-att-spoofed` }))
    expect(rSpoofed.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })
    const attAfterSpoofed = (await findAttachmentsForConversation({ admin: admin as never, conversationId })).find((a) => a.externalMediaId === 'uat7a-att-spoofed')
    expect(attAfterSpoofed?.status).toBe('failed')
    log('UAT-14/spoofed-mime-rejected', attAfterSpoofed)

    // (b2) Oversized (declared file_size > 25MB cap) -> rejected, never staged.
    const rOversized = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, mediaType: 'image', mediaId: 'uat7a-att-oversized', mimeType: 'image/jpeg', fileName: 'huge.jpg', messageId: `${RUN_TAG}-att-oversized` }))
    expect(rOversized.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_file' })
    const attAfterOversized = (await findAttachmentsForConversation({ admin: admin as never, conversationId })).find((a) => a.externalMediaId === 'uat7a-att-oversized')
    expect(attAfterOversized?.status).toBe('failed')
    log('UAT-14/oversized-rejected', attAfterOversized)

    const { count: countBeforeValid } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('requester_id', persona.id)
    expect(countBeforeValid).toBe(0) // no ticket was ever created off either bad attachment

    // (a) Valid small JPEG -> staged BEFORE Review.
    const rValid = await send(buildMediaMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, mediaType: 'image', mediaId: 'uat7a-att-valid', mimeType: 'image/jpeg', fileName: 'counter1.jpg', messageId: `${RUN_TAG}-att-valid` }))
    expect(rValid.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    const stagedNow = await findAttachmentsForConversation({ admin: admin as never, conversationId })
    const staged = stagedNow.find((a) => a.externalMediaId === 'uat7a-att-valid')
    expect(staged?.status).toBe('staged')
    expect(staged!.storagePath).toMatch(/^staging\//)
    log('UAT-13/staged-before-review', staged)

    const mediaCallsBeforeCreate = mock.calls.filter((c) => c.url.includes('uat7a-att-valid') || c.url.includes('mock-media.example')).length

    // (c) Review -> Create.
    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: commandButtonId('create'), kind: 'button_reply', messageId: `${RUN_TAG}-att-create` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    // No second Meta media download after Create — count of media-related fetch calls is unchanged.
    const mediaCallsAfterCreate = mock.calls.filter((c) => c.url.includes('uat7a-att-valid') || c.url.includes('mock-media.example')).length
    expect(mediaCallsAfterCreate).toBe(mediaCallsBeforeCreate)
    log('UAT-15/no-second-meta-download', { mediaCallsBeforeCreate, mediaCallsAfterCreate })

    const linkedNow = (await findAttachmentsForConversation({ admin: admin as never, conversationId })).find((a) => a.externalMediaId === 'uat7a-att-valid')
    expect(linkedNow?.status).toBe('linked')

    const { data: created } = await admin.from('requests').select('id, request_no').eq('requester_id', persona.id).single()
    const { data: linkedAttachment } = await admin.from('request_attachments').select('*').eq('request_id', created!.id).single()
    expect(linkedAttachment).toBeTruthy()
    expect(linkedAttachment!.mime_type).toBe('image/jpeg')
    // Visible via a direct DB read exactly like a web-uploaded attachment — same table/shape.
    log('UAT-15/final-linked-attachment', { requestNo: created?.request_no, linkedAttachment })
  }, 60_000)

  // ── UAT Fixture — Field Types (UAT-12: radio / multiselect / checkbox / email) ──
  it('creates the shared UAT Fixture — Field Types service and walks a full conversation collecting all 4 field types, incl. an invalid email attempt', async () => {
    const teamPrefix = `U${Date.now().toString(36).slice(-5).toUpperCase()}`
    const departmentId = await createTestDepartment(admin, `UAT7a Fixture Department (${RUN_TAG})`, ORG_ID)
    const { data: team, error: teamErr } = await admin.from('teams').insert({
      name: `UAT7a Fixture Team (${RUN_TAG})`, slug: `uat7a-fixture-team-${RUN_TAG}`, prefix: teamPrefix, department_id: departmentId, org_id: ORG_ID,
    }).select('id').single()
    if (teamErr || !team) throw new Error(`team: ${teamErr?.message}`)

    const fields: FormField[] = [
      { id: 'urgency', type: 'radio', label: 'Urgency', required: true, order: 0, options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
      { id: 'affected_systems', type: 'multiselect', label: 'Affected Systems', required: true, order: 1, options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }, { value: 'network', label: 'Network' }] },
      { id: 'impact_confirmed', type: 'checkbox', label: 'Business Impact Confirmed', required: true, order: 2 },
      { id: 'contact_email', type: 'email', label: 'Contact Email', required: true, order: 3 },
    ]
    const { data: service, error: serviceErr } = await admin.from('services').insert({
      name: `UAT Fixture — Field Types (${RUN_TAG})`,
      slug: `uat-fixture-field-types-${RUN_TAG}`,
      team_id: team.id,
      org_id: ORG_ID,
      default_priority: 'medium',
      status: 'published',
      is_active: true,
      form_fields: [],
      form_sections: [{ id: 'sec1', title: 'Field Type Coverage', order: 0, fields }],
    }).select('id').single()
    if (serviceErr || !service) throw new Error(`service: ${serviceErr?.message}`)

    const { data: category, error: catErr } = await admin.from('service_categories').insert({
      name: `UAT7a Fixture Category (${RUN_TAG})`, slug: `uat7a-fixture-category-${RUN_TAG}`, org_id: ORG_ID,
    }).select('id').single()
    if (catErr || !category) throw new Error(`category: ${catErr?.message}`)

    const { data: subCategory, error: subErr } = await admin.from('service_sub_categories').insert({
      name: `Field Type Coverage Issue (${RUN_TAG})`, slug: `uat7a-fixture-subcat-${RUN_TAG}`, category_id: category.id, is_active: true, sla_priority: 'medium',
    }).select('id').single()
    if (subErr || !subCategory) throw new Error(`sub-category: ${subErr?.message}`)

    const { error: tagErr } = await admin.from('service_sub_category_tags').insert({ service_id: service.id, sub_category_id: subCategory.id })
    if (tagErr) throw new Error(`tag: ${tagErr.message}`)

    log('UAT-12/fixture-service-created', { serviceId: service.id, teamId: team.id, categoryId: category.id, subCategoryId: subCategory.id, name: `UAT Fixture — Field Types (${RUN_TAG})` })

    const persona = await makePersona(admin, 'uat12', '9700000011')
    const sender = meta('9700000011')
    const mock = createMockGraphFetch()
    const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Hi', messageId: `${RUN_TAG}-f12-1` }))
    const r2 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: service.id, messageId: `${RUN_TAG}-f12-2` }))
    expect(r2.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_issue_search' })
    await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'field type', messageId: `${RUN_TAG}-f12-3` }))
    const r4 = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: subCategory.id, messageId: `${RUN_TAG}-f12-4` }))
    expect(r4.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })
    const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'Testing all four dynamic field types end to end.', messageId: `${RUN_TAG}-f12-5` }))
    expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // radio (Urgency) first

    // radio — invalid option first, then valid.
    const rBadRadio = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: 'not-a-real-option', kind: 'list_reply', messageId: `${RUN_TAG}-f12-radio-bad` }))
    expect(rBadRadio.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // stayed put
    const rGoodRadio = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: 'high', kind: 'list_reply', messageId: `${RUN_TAG}-f12-radio-good` }))
    expect(rGoodRadio.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // multiselect next

    // multiselect — invalid token, then valid comma-separated positions (1,3 = hardware, network).
    const rBadMulti = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '9,10', messageId: `${RUN_TAG}-f12-multi-bad` }))
    expect(rBadMulti.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // stayed put
    const rGoodMulti = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: '1,3', messageId: `${RUN_TAG}-f12-multi-good` }))
    expect(rGoodMulti.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // checkbox next

    // checkbox — FINDING F-02, FIXED in Stage 7.1: a truthful "No" used to be
    // rejected as if the field were EMPTY (isFieldValueEmpty() treated
    // `false` as empty for every field type), so a mandatory checkbox could
    // never be honestly answered "No". isFieldValueEmpty() is now
    // field-type-aware: only null/undefined counts as empty for
    // checkbox/toggle, so "No" -> false now correctly ADVANCES past the
    // field instead of staying put.
    const rCheckboxNo = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'No', messageId: `${RUN_TAG}-f12-cb-no` }))
    expect(rCheckboxNo.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // advances to email next, no longer stuck on the checkbox

    // email — invalid format, then valid.
    const rBadEmail = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'not-an-email', messageId: `${RUN_TAG}-f12-email-bad` }))
    expect(rBadEmail.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' }) // stayed put
    const rGoodEmail = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: sender, body: 'uat7a.persona@example.test', messageId: `${RUN_TAG}-f12-email-good` }))
    expect(rGoodEmail.outcome).toMatchObject({ kind: 'processed', state: 'review' })

    const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: sender, replyId: commandButtonId('create'), kind: 'button_reply', messageId: `${RUN_TAG}-f12-create` }))
    expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

    const { data: created } = await admin.from('requests').select('request_no, form_data, category_id, sub_category_id').eq('requester_id', persona.id).single()
    const fd = created!.form_data as Record<string, unknown>
    expect(fd.urgency).toBe('high')
    expect(fd.affected_systems).toEqual(['hardware', 'network'])
    expect(fd.impact_confirmed).toBe(true)
    expect(fd.contact_email).toBe('uat7a.persona@example.test')
    expect(created!.category_id).toBe(category.id)
    expect(created!.sub_category_id).toBe(subCategory.id)
    log('UAT-12/final-ticket-all-four-field-types', created)
  }, 60_000)
})
