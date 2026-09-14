/**
 * Stage 7 UAT (Step 23 of the Stage 7B execution brief) — UAT-30:
 * deactivating a service mid-WhatsApp-conversation must never produce a
 * stale/invalid ticket, and the recovery UX must be captured precisely.
 *
 * Uses a tagged, owned fixture service (never a real production service —
 * the brief explicitly forbids deactivating real production config), run
 * through the REAL webhook pipeline. Matches stage4-config-drift.test.ts's
 * scenario class (that file proves the same guarantee at the
 * processConversationInbound layer for a field-added/option-removed drift;
 * this proves it at the full webhook layer for a service-deactivated drift).
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
const RUN_TAG = `uat7b-8c5d02-drift-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'business_impact', type: 'textarea', label: 'Business Impact', required: true, order: 0 }]

describe('Stage 7B — UAT-30: service deactivated mid-WhatsApp-conversation on a tagged fixture service', () => {
  const admin = getAdmin()

  it('deactivating the service between REVIEW and CREATE blocks CREATE safely and never produces a stale ticket', async () => {
    const fx = await setupConversationFixture({ runTag: RUN_TAG, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: RUN_TAG, orgId: fx.orgId, phoneNumberId: `1562${RUN_TAG.slice(-6)}` })
    const requester = await createTestUser('uat7b-drift-req', 'UAT7B Config Drift Requester')
    const sender = '9700500001'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
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
      const rReview = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Billing counter cannot print.', runTag: RUN_TAG }))
      expect(rReview.outcome).toMatchObject({ kind: 'processed', state: 'review' })

      // Admin action (never through WhatsApp): the fixture service is
      // deactivated mid-conversation, AFTER Review, mirroring UAT-30's
      // "admin deactivates IT Support" scenario but against an owned
      // fixture — is_active=false is the same flag Stage 6's own audit used
      // to identify a service as no longer WhatsApp-selectable.
      const { error: deactivateError } = await admin.from('services').update({ is_active: false }).eq('id', fx.serviceId)
      expect(deactivateError).toBeNull()

      // UAT-30's own next step: the requester sends the next answer — here,
      // the CREATE confirmation they were already being asked for.
      const rCreate = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: commandButtonId('create'), kind: 'button_reply', runTag: RUN_TAG }))

      // Exact recovery UX captured: processed (not a crash/500), but NOT
      // completed — a safe re-prompt/abort rather than a stale ticket.
      expect(rCreate.outcome).toMatchObject({ kind: 'processed' })
      expect((rCreate.outcome as { state: string }).state).not.toBe('completed')

      const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
      expect(count).toBe(0) // no stale/invalid ticket created against the now-deactivated service

      const { data: convRow } = await admin.from('request_conversations').select('state, service_id, request_id').eq('requester_id', requester.id).single()
      expect(convRow?.request_id).toBeNull()
      // Captured exact recovery UX for the report: state/service_id below.
      console.log('[UAT-30 evidence] post-deactivation CREATE outcome:', JSON.stringify(rCreate.outcome), 'conversation row:', JSON.stringify(convRow))
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  }, 60_000)

  it('deactivating the service mid-flow (before Review, right after sub-category selection) is reconciled the same safe way on the next answer', async () => {
    const fx = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS })
    const wa = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: fx.orgId, phoneNumberId: `1563${RUN_TAG.slice(-6)}` })
    const requester = await createTestUser('uat7b-drift-req-b', 'UAT7B Config Drift Requester B')
    const sender = '9700500002'
    await admin.from('profiles').update({ mobile_number: sender, whatsapp_enabled: true, is_active: true }).eq('id', requester.id)
    mockedCreateClient.mockResolvedValue(admin as never)
    const senderMeta = `91${sender}`

    try {
      const mock = createMockGraphFetch()
      const send = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, wa.appSecret), fetchImpl: mock.fetchImpl })

      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Hi', runTag: `${RUN_TAG}-b` }))
      await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.serviceId, runTag: `${RUN_TAG}-b` }))
      await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'printer issue', runTag: `${RUN_TAG}-b` }))
      const rSubcat = await send(buildInteractivePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, replyId: fx.subCategoryId, runTag: `${RUN_TAG}-b` }))
      expect(rSubcat.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_description' })

      await admin.from('services').update({ is_active: false }).eq('id', fx.serviceId)

      // FINDING F-30 (see run report), FIXED during Stage 7: the
      // config-drift safety net itself used to crash when the service was
      // invalidated while the conversation was precisely in
      // 'awaiting_description'. handleAwaitingDescription's reconciliation
      // calls sendBackToServiceSelection(), which always targets state
      // 'awaiting_service' (orchestrator.ts:472-490) — but
      // lib/conversations/state-machine.ts's FORWARD_TRANSITIONS table only
      // allowed 'awaiting_service' as a legal target from
      // 'collecting_fields'/'awaiting_file'/'review'/'awaiting_subcategory'/
      // 'awaiting_issue_search', NOT from 'awaiting_description'. Fixed by
      // adding 'awaiting_service' to 'awaiting_description''s legal-target
      // list. Re-asserted here: the exact state right after sub-category
      // selection now reconciles safely, same as every other state that can
      // hit config drift mid-conversation.
      let driftThrew: Error | null = null
      let rNext: Awaited<ReturnType<typeof send>> | null = null
      try {
        rNext = await send(buildTextMessagePayload({ phoneNumberId: wa.phoneNumberId, from: senderMeta, body: 'Printer down.', runTag: `${RUN_TAG}-b` }))
      } catch (e) {
        driftThrew = e as Error
      }
      expect(driftThrew).toBeNull() // no more uncaught crash
      expect(rNext?.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' }) // safely bounced back to service selection

      const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('service_id', fx.serviceId)
      expect(count).toBe(0) // no stale ticket
      const { data: convRow } = await admin.from('request_conversations').select('state, service_id, request_id').eq('requester_id', requester.id).single()
      expect(convRow?.state).toBe('awaiting_service') // reconciled back to service selection, not stuck/corrupted
      expect(convRow?.service_id).toBeNull() // the invalidated service was cleared
      expect(convRow?.request_id).toBeNull()
    } finally {
      await admin.from('conversation_events').delete().eq('org_id', fx.orgId).ilike('external_message_id', `%${RUN_TAG}-b%`)
      await admin.from('request_conversations').delete().eq('requester_id', requester.id)
      await admin.from('requests').delete().eq('requester_id', requester.id)
      await admin.auth.admin.deleteUser(requester.id)
      await wa.cleanup()
      await fx.cleanup()
    }
  }, 60_000)
})
