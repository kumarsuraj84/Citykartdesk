/**
 * Stage 7 UAT (Step 22 of the Stage 7B execution brief) — UAT-28 (same
 * mobile number resolving to two different orgs never cross-resolves) and
 * UAT-29 (a crafted/replayed cross-org interactive selection id is safely
 * rejected). The most safety-critical check in this run.
 *
 * A second, temporary org ("Org B") with its own WhatsApp channel/
 * phone_number_id is created here and torn down completely in this file's
 * own afterAll — unlike the shared UAT-org-A personas/fixtures, which
 * persist for centralized Stage 7 cleanup.
 *
 * Follows stage4-tenant-isolation.test.ts's pattern (the brief's named
 * reference for this scenario class), but run through the REAL webhook
 * pipeline (processWhatsAppWebhookPayload) since destination phone_number_id
 * resolution — the actual mechanism UAT-28 verifies — only exists at that
 * layer, not at processConversationInbound()'s.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import { setupWhatsAppChannelFixture, signPayload, buildTextMessagePayload, buildInteractivePayload, createMockGraphFetch, type WhatsAppChannelFixture } from '../setup/whatsapp-fixtures'
import type { FormField } from '@/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'
import { findActiveConversation } from '@/lib/conversations'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `uat7b-8c5d02-tenant-${Date.now()}`
const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]
const SHARED_MOBILE = '9700400001' // the SAME mobile number used by both org A's and org B's persona
const SHARED_MOBILE_META = `91${SHARED_MOBILE}`

describe('Stage 7B — UAT-28/UAT-29: WhatsApp tenant isolation (same mobile number in two orgs, crafted cross-org selection)', () => {
  const admin = getAdmin()
  let orgBId: string
  let fxA: ConversationFixture
  let fxB: ConversationFixture
  let waA: WhatsAppChannelFixture
  let waB: WhatsAppChannelFixture
  let requesterA: TestUser
  let requesterB: TestUser

  beforeAll(async () => {
    const { data: orgB, error: orgBError } = await admin
      .from('organizations')
      .insert({ name: `UAT7B Tenant Org B ${RUN_TAG}`, slug: `uat7b-tenant-org-b-${RUN_TAG}` })
      .select('id').single()
    if (orgBError || !orgB) throw new Error(`[uat7b tenant] org B: ${orgBError?.message}`)
    orgBId = orgB.id

    fxA = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
    fxB = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS, orgId: orgBId })

    waA = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-a`, orgId: fxA.orgId, phoneNumberId: `1560${RUN_TAG.slice(-6)}` })
    waB = await setupWhatsAppChannelFixture({ runTag: `${RUN_TAG}-b`, orgId: orgBId, phoneNumberId: `1561${RUN_TAG.slice(-6)}` }) // DIFFERENT real phone_number_id, own channel

    requesterA = await createTestUser('uat7b-tenant-req-a', 'UAT7B Tenant Requester A')
    requesterB = await createTestUser('uat7b-tenant-req-b', 'UAT7B Tenant Requester B')
    // The SAME mobile number, deliberately, on two profiles in two different orgs.
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', requesterA.id)
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true, org_id: orgBId }).eq('id', requesterB.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: requesterA.id, org_id: fxA.orgId, mobile_number: SHARED_MOBILE })
    await admin.from('profile_mobile_numbers').insert({ profile_id: requesterB.id, org_id: orgBId, mobile_number: SHARED_MOBILE })

    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await admin.from('conversation_events').delete().eq('org_id', fxA.orgId).ilike('external_message_id', `%${RUN_TAG}%`)
    await admin.from('conversation_events').delete().eq('org_id', orgBId)
    await admin.from('request_conversations').delete().eq('requester_id', requesterA.id)
    await admin.from('request_conversations').delete().eq('org_id', orgBId)
    await admin.from('requests').delete().eq('requester_id', requesterA.id)
    await admin.from('requests').delete().eq('org_id', orgBId)
    await admin.auth.admin.deleteUser(requesterA.id)
    await admin.auth.admin.deleteUser(requesterB.id)
    await waA.cleanup()
    await waB.cleanup()
    await fxA.cleanup()
    await fxB.cleanup()
    // Org B is this file's own temporary fixture — deleted completely here,
    // unlike the shared UAT-org-A personas which persist for centralized
    // Stage 7 cleanup.
    await deleteTestOrg(admin, orgBId)
  }, 60_000)

  it('UAT-28a: destination phone_number_id determines org FIRST — the identical shared mobile sending to Org A\'s channel resolves only to Org A\'s requester/conversation', async () => {
    const mock = createMockGraphFetch()
    const rawBody = buildTextMessagePayload({ phoneNumberId: waA.phoneNumberId, from: SHARED_MOBILE_META, body: 'Hi', runTag: `${RUN_TAG}-a` })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, waA.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

    const conversationId = (result.outcome as { conversationId: string }).conversationId
    const { data: row } = await admin.from('request_conversations').select('org_id, requester_id').eq('id', conversationId).single()
    expect(row?.org_id).toBe(fxA.orgId)
    expect(row?.requester_id).toBe(requesterA.id)
    expect(row?.requester_id).not.toBe(requesterB.id)
  }, 60_000)

  it('UAT-28b: the SAME shared mobile sending to Org B\'s DIFFERENT channel resolves only to Org B\'s requester/conversation — never cross-resolves to Org A', async () => {
    const mock = createMockGraphFetch()
    const rawBody = buildTextMessagePayload({ phoneNumberId: waB.phoneNumberId, from: SHARED_MOBILE_META, body: 'Hi', runTag: `${RUN_TAG}-b` })
    const result = await processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, waB.appSecret), fetchImpl: mock.fetchImpl })
    expect(result.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

    const conversationId = (result.outcome as { conversationId: string }).conversationId
    const { data: row } = await admin.from('request_conversations').select('org_id, requester_id').eq('id', conversationId).single()
    expect(row?.org_id).toBe(orgBId)
    expect(row?.requester_id).toBe(requesterB.id)
    expect(row?.requester_id).not.toBe(requesterA.id)
    expect(row?.org_id).not.toBe(fxA.orgId)

    // Two DISTINCT active conversations exist for the identical mobile
    // number — one genuinely scoped to each org, never merged/shared.
    const activeA = await findActiveConversation({ admin: admin as never, orgId: fxA.orgId, channelType: 'whatsapp', channelIdentity: SHARED_MOBILE_META })
    const activeB = await findActiveConversation({ admin: admin as never, orgId: orgBId, channelType: 'whatsapp', channelIdentity: SHARED_MOBILE_META })
    expect(activeA?.id).not.toBe(activeB?.id)
    expect(activeA?.orgId).toBe(fxA.orgId)
    expect(activeB?.orgId).toBe(orgBId)
  }, 60_000)

  it('UAT-29: a crafted/replayed interactive selection id from Org A\'s conversation, sent against Org B\'s conversation, is safely rejected — no cross-org state change, no data leak', async () => {
    // Org A's requester progresses to a real, valid selection: Org A's own
    // serviceId, which is a perfectly legitimate selectionId — but ONLY
    // inside Org A's conversation. This is the exact "crafted/replayed
    // selection ID belonging to another org's conversation" scenario.
    const mock = createMockGraphFetch()
    const sendA = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, waA.appSecret), fetchImpl: mock.fetchImpl })
    const sendB = async (rawBody: string) => processWhatsAppWebhookPayload({ admin: admin as never, rawBody, signatureHeader: signPayload(rawBody, waB.appSecret), fetchImpl: mock.fetchImpl })

    // A DIFFERENT Org A sender (not the shared-mobile one, to keep this
    // check isolated from the two tests above) opens a real Org A
    // conversation and reaches awaiting_issue_search — the state where
    // fxA.serviceId becomes "a real, currently valid selection ID" in Org
    // A's own conversation.
    const senderAOnly = '9700400002'
    const freshA = await createTestUser('uat7b-tenant-req-a2', 'UAT7B Tenant Requester A2')
    await admin.from('profiles').update({ whatsapp_enabled: true, is_active: true }).eq('id', freshA.id)
    await admin.from('profile_mobile_numbers').insert({ profile_id: freshA.id, org_id: fxA.orgId, mobile_number: senderAOnly })

    try {
      const rNewA = await sendA(buildTextMessagePayload({ phoneNumberId: waA.phoneNumberId, from: `91${senderAOnly}`, body: 'Hi', runTag: `${RUN_TAG}-iso` }))
      expect(rNewA.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })

      // Org B's requester opens their own, separate, legitimate conversation.
      const rNewB = await sendB(buildTextMessagePayload({ phoneNumberId: waB.phoneNumberId, from: SHARED_MOBILE_META, body: 'Hi', runTag: `${RUN_TAG}-iso` }))
      expect(rNewB.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' })
      const orgBConversationId = (rNewB.outcome as { conversationId: string }).conversationId
      const beforeAttack = await admin.from('request_conversations').select('*').eq('id', orgBConversationId).single()

      // The attack: Org A's REAL, currently-valid serviceId (fxA.serviceId)
      // sent as an interactive selection reply against Org B's channel/
      // conversation. fxA.serviceId does not exist as an offered option in
      // Org B's own service catalog (fxB.serviceId is a DIFFERENT id in a
      // DIFFERENT org) — this must be rejected exactly like any other
      // invalid/unknown selection, never silently accepted or resolved
      // against Org A's data.
      const attackBody = buildInteractivePayload({ phoneNumberId: waB.phoneNumberId, from: SHARED_MOBILE_META, replyId: fxA.serviceId, runTag: `${RUN_TAG}-iso` })

      // FINDING F-29 (see run report), FIXED during Stage 7: an
      // unrecognized/invalid service selection at the very first state
      // (awaiting_service) used to throw an UNHANDLED exception instead of
      // safely re-prompting, because state-machine.ts's FORWARD_TRANSITIONS
      // table gave every OTHER active state a self-loop entry for
      // errorStayingPut()'s "stay in the same state and re-prompt" commit,
      // but the 'awaiting_service' row was missing its own. Fixed by making
      // the self-loop (from === to) blanket-legal for every active,
      // non-submitting state in canTransition() — the same state set
      // CANCELLABLE_STATES already defines — rather than relying on each
      // row remembering to list itself. Re-asserted here: this crafted
      // cross-org attempt now returns a normal "processed" outcome (a safe
      // re-prompt), never a crash.
      let attackThrew: Error | null = null
      let attackResult: Awaited<ReturnType<typeof sendB>> | null = null
      try {
        attackResult = await sendB(attackBody)
      } catch (e) {
        attackThrew = e as Error
      }
      expect(attackThrew).toBeNull() // no more uncaught crash
      expect(attackResult?.outcome).toMatchObject({ kind: 'processed', state: 'awaiting_service' }) // safely re-prompted, same state

      // The safety-critical part: NO cross-org write ever happened — Org
      // B's conversation never adopted Org A's service, never advanced
      // past a self-loop re-prompt.
      const afterAttack = await admin.from('request_conversations').select('*').eq('id', orgBConversationId).single()
      expect(afterAttack.data?.service_id).not.toBe(fxA.serviceId) // never adopted Org A's service
      expect(afterAttack.data?.org_id).toBe(orgBId) // still Org B's conversation
      expect(afterAttack.data?.state).toBe('awaiting_service') // no illegitimate state advancement — re-prompted the same state, not advanced
      // errorStayingPut() still commits (to refresh last_activity_at/expires_at and
      // mark the event completed) even though the state itself doesn't change, so
      // the version legitimately increments by exactly one re-prompt commit — the
      // safety guarantee is "never adopted Org A's data / never advanced state",
      // not "zero writes at all".
      expect(afterAttack.data?.version).toBe((beforeAttack.data?.version ?? 0) + 1)

      // No cross-org data leak: Org A's own conversation is completely
      // untouched by this attack against Org B's channel.
      const orgAConversation = await findActiveConversation({ admin: admin as never, orgId: fxA.orgId, channelType: 'whatsapp', channelIdentity: `91${senderAOnly}` })
      expect(orgAConversation?.state).toBe('awaiting_service')
      expect(orgAConversation?.orgId).toBe(fxA.orgId)
    } finally {
      await admin.from('request_conversations').delete().eq('requester_id', freshA.id)
      await admin.auth.admin.deleteUser(freshA.id)
    }
  }, 60_000)
})
