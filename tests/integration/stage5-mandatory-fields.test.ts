/**
 * Stage 5, Step 28 — the WhatsApp transport cannot skip any
 * requester-mandatory template field, and must go straight to Review when
 * there are none beyond Description/Subject (Step 15/AC-5.14/AC-5.15).
 * Also proves Step 9's multiselect requirement: answered correctly via
 * comma-separated free text, never silently reduced to single-select.
 */
import { describe, it, expect, vi } from 'vitest'
import { getAdmin, createTestUser } from '../setup/fixtures-d03'
import { setupConversationFixture } from '../setup/conversation-fixtures'
import { setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, createMockGraphFetch } from '../setup/whatsapp-fixtures'
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
const RUN_TAG = `stage5-fields-${Date.now()}`

describe('Stage 5 — mandatory field collection over WhatsApp', () => {
  const admin = getAdmin()

  it('asks every mandatory field (Printer Location, Business Impact, Asset Number) before Review — none skippable', async () => {
    const fields: FormField[] = [
      { id: 'printer_location', type: 'text', label: 'Printer Location', required: true, order: 0 },
      { id: 'business_impact', type: 'checkbox', label: 'Business Impact', required: true, order: 1 },
      { id: 'asset_number', type: 'text', label: 'Asset Number', required: true, order: 2 },
    ]
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields })
    const requester = await createTestUser('stage5-fields-req-a', 'Stage5 Fields A')
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-a`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}1` })
    const sender = '9666300001'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: RUN_TAG }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: RUN_TAG }))
      const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down since morning.', runTag: RUN_TAG }))
      expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

      const rF1 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Billing Counter 2', runTag: RUN_TAG }))
      expect(rF1.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

      const rF2 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Yes', runTag: RUN_TAG }))
      expect(rF2.outcome).toMatchObject({ kind: 'processed', state: 'collecting_fields' })

      const rF3 = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'AST-00042', runTag: RUN_TAG }))
      expect(rF3.outcome).toMatchObject({ kind: 'processed', state: 'review' })

      const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
      expect(rCreate.outcome).toMatchObject({ kind: 'processed', state: 'completed' })

      const { data: created } = await admin.from('requests').select('form_data').eq('requester_id', requester.id).single()
      const formData = created!.form_data as Record<string, unknown>
      expect(formData.printer_location).toBe('Billing Counter 2')
      expect(formData.business_impact).toBe(true)
      expect(formData.asset_number).toBe('AST-00042')
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('with no mandatory fields beyond description, goes straight from Description to Review', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: [] })
    const requester = await createTestUser('stage5-fields-req-b', 'Stage5 Fields B')
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}2` })
    const sender = '9666300002'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: RUN_TAG }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: RUN_TAG }))
      const rDesc = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: RUN_TAG }))

      // No mandatory fields configured — straight to review, no invented questions.
      expect(rDesc.outcome).toMatchObject({ kind: 'processed', state: 'review' })
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })

  it('multiselect: answered via comma-separated free text, never silently reduced to a single value', async () => {
    const fields: FormField[] = [{
      id: 'affected_areas', type: 'multiselect', label: 'Affected Areas', required: true, order: 0,
      options: [{ value: 'hardware', label: 'Hardware' }, { value: 'software', label: 'Software' }, { value: 'network', label: 'Network' }],
    }]
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-c`, fields })
    const requester = await createTestUser('stage5-fields-req-c', 'Stage5 Fields C')
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-c`, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-5)}3` })
    const sender = '9666300003'
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requester.id, org_id: fx.orgId, mobile_number: sender })
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: RUN_TAG }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: RUN_TAG }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: RUN_TAG }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: RUN_TAG }))

      // Reply with option POSITIONS (1-based, matching the renderer's own
      // numbered list — see whatsapp-render.test.ts) — picks two of three.
      const rAnswer = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: '1,3', runTag: RUN_TAG }))
      expect(rAnswer.outcome).toMatchObject({ kind: 'processed', state: 'review' })

      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))
      const { data: created } = await admin.from('requests').select('form_data').eq('requester_id', requester.id).single()
      expect((created!.form_data as Record<string, unknown>).affected_areas).toEqual(['hardware', 'network'])
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  })
})
