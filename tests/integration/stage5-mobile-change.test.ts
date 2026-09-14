/**
 * Stage 5, Step 29 — Stage 2's mobile-number-is-the-only-source-of-truth
 * behavior, proven through the REAL Stage 5 webhook adapter (not by calling
 * resolveUserByWhatsAppNumber directly). Changing profiles.mobile_number in
 * DESK immediately changes WhatsApp eligibility with no separate WhatsApp
 * mapping to update (AC-5.20).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import { setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, createMockGraphFetch, type WhatsAppChannelFixture } from '../setup/whatsapp-fixtures'
import type { FormField } from '@/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage5-mobile-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]

describe('Stage 5 — mobile-number change immediately changes WhatsApp eligibility', () => {
  let fx: ConversationFixture
  let wa: WhatsAppChannelFixture
  let requester: TestUser
  const admin = getAdmin()
  const OLD_NUMBER = '9666400001'
  const NEW_NUMBER = '9812345678'

  beforeAll(async () => {
    fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fx.orgId, phoneNumberId: `1555${RUN_TAG.slice(-6)}` })
    requester = await createTestUser('stage5-mobile-requester', 'Stage5 Mobile Change')
    await admin.from('profiles').update({ mobile_number: OLD_NUMBER, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
    await admin.auth.admin.deleteUser(requester.id)
    await wa.cleanup()
    await fx.cleanup()
  }, 60_000)

  it('resolves via the old number, then rejects the old number and resolves the new one after a DESK mobile change — no WhatsApp-side update needed', async () => {
    const mock = createMockGraphFetch()
    const send = async (from: string, body: string) => {
      const rawBody = buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from, body, runTag: RUN_TAG })
      return processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })
    }

    // Old number resolves and starts a conversation.
    const before = await send(`91${OLD_NUMBER}`, 'Hi')
    expect(before.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

    // Admin updates the DESK mobile number (source of truth) — no WhatsApp
    // mapping table exists to also update.
    await admin.from('profiles').update({ mobile_number: NEW_NUMBER }).eq('id', requester.id)

    // The OLD number no longer resolves to this (or any) requester.
    const oldAfter = await send(`91${OLD_NUMBER}`, 'Hi')
    expect(oldAfter.outcome).toMatchObject({ kind: 'rejected_sender', reason: 'not_registered' })

    // The NEW number resolves immediately, with zero WhatsApp-side config change.
    const newAfter = await send(`91${NEW_NUMBER}`, 'Hi')
    expect(newAfter.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

    await admin.from('request_conversations').delete().eq('requester_id', requester.id)
  })
})
