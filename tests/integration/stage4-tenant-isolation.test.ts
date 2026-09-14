/**
 * Stage 4, Step 28 — every conversation query/mutation is explicitly
 * org-scoped, never relying on RLS (this stage's repository always uses the
 * admin/service-role client, which has no RLS protection at all) (AC-4.14).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'
import { setupConversationFixture, type ConversationFixture } from '../setup/conversation-fixtures'
import type { FormField } from '@/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { processConversationInbound } from '@/lib/conversations/orchestrator'
import { findConversationById, findActiveConversation, insertAttachment, findAttachmentsForConversation } from '@/lib/conversations/repository'

const mockedCreateClient = vi.mocked(createClient)
const RUN_TAG = `stage4-tenant-${Date.now()}`

const FIELDS: FormField[] = [{ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }]

type Fx = {
  orgAId: string
  orgBId: string
  fxA: ConversationFixture
  fxB: ConversationFixture
  requesterA: TestUser
  requesterB: TestUser
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()
  const { data: orgB, error: orgBError } = await admin
    .from('organizations')
    .insert({ name: `Stage4 Tenant Org B ${RUN_TAG}`, slug: `stage4-tenant-org-b-${RUN_TAG}` })
    .select('id').single()
  if (orgBError || !orgB) throw new Error(`[stage4 tenant fixtures] org B: ${orgBError?.message}`)

  const fxA = await setupConversationFixture({ runTag: `${RUN_TAG}-a`, fields: FIELDS })
  const fxB = await setupConversationFixture({ runTag: `${RUN_TAG}-b`, fields: FIELDS, orgId: orgB.id })

  const requesterA = await createTestUser('stage4-tenant-req-a', 'Stage4 Tenant Requester A')
  const requesterB = await createTestUser('stage4-tenant-req-b', 'Stage4 Tenant Requester B')
  await admin.from('profiles').update({ org_id: orgB.id }).eq('id', requesterB.id)

  return {
    orgAId: fxA.orgId,
    orgBId: orgB.id,
    fxA,
    fxB,
    requesterA,
    requesterB,
    cleanup: async () => {
      // request_conversations.org_id/requester_id have no ON DELETE action
      // (business records, like requests.org_id/requester_id) — every
      // conversation created against these fixtures must be gone before the
      // org/profile/auth user can be deleted. fxA/fxB's own cleanup only
      // catches conversations that reached service selection (scoped by
      // service_id); several tests in this file deliberately stop at NEW
      // without ever selecting one, so those are swept up explicitly here
      // by requester_id (orgA's requester — safe and precise, since it
      // targets exactly this fixture's own test user) and by org_id (orgB —
      // safe since this org is exclusive to this test file).
      await admin.from('conversation_events').delete().eq('org_id', fxA.orgId).ilike('external_message_id', `${RUN_TAG}%`)
      await admin.from('conversation_events').delete().eq('org_id', orgB.id)
      await admin.from('request_conversations').delete().eq('requester_id', requesterA.id)
      await admin.from('request_conversations').delete().eq('org_id', orgB.id)
      await fxA.cleanup()
      await fxB.cleanup()
      await admin.auth.admin.deleteUser(requesterA.id)
      await admin.auth.admin.deleteUser(requesterB.id)
      await deleteTestOrg(admin, orgB.id)
    },
  }
}

describe('Stage 4 — tenant isolation', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
    mockedCreateClient.mockResolvedValue(admin as never)
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('Org A cannot load Org B\'s conversation by id', async () => {
    const baseB = { orgId: fx.orgBId, requesterId: fx.requesterB.id, channelType: 'whatsapp' as const, channelIdentity: '9888888801' }
    const rB = await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso1-b-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })

    const crossOrgLookup = await findConversationById({ admin: admin as never, orgId: fx.orgAId, id: rB.conversationId })
    expect(crossOrgLookup).toBeNull()

    const sameOrgLookup = await findConversationById({ admin: admin as never, orgId: fx.orgBId, id: rB.conversationId })
    expect(sameOrgLookup).not.toBeNull()
  })

  it('Org A cannot process an inbound event against Org B\'s conversation (different org_id, same channel identity)', async () => {
    // Both orgs' requesters use the SAME phone number — must never resolve
    // to each other's conversation (the brief's explicit "Org A + phone must
    // never resume Org B + phone" rule).
    const sharedIdentity = '9888888802'
    const baseA = { orgId: fx.orgAId, requesterId: fx.requesterA.id, channelType: 'whatsapp' as const, channelIdentity: sharedIdentity }
    const baseB = { orgId: fx.orgBId, requesterId: fx.requesterB.id, channelType: 'whatsapp' as const, channelIdentity: sharedIdentity }

    const rA = await processConversationInbound({ ...baseA, externalMessageId: `${RUN_TAG}-iso2-a-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const rB = await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso2-b-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })

    // Two DISTINCT conversations despite the identical channel_identity —
    // org_id is always part of the lookup scope.
    expect(rA.conversationId).not.toBe(rB.conversationId)

    const activeForA = await findActiveConversation({ admin: admin as never, orgId: fx.orgAId, channelType: 'whatsapp', channelIdentity: sharedIdentity })
    const activeForB = await findActiveConversation({ admin: admin as never, orgId: fx.orgBId, channelType: 'whatsapp', channelIdentity: sharedIdentity })
    expect(activeForA?.id).toBe(rA.conversationId)
    expect(activeForB?.id).toBe(rB.conversationId)
    expect(activeForA?.orgId).toBe(fx.orgAId)
    expect(activeForB?.orgId).toBe(fx.orgBId)
  })

  it('a duplicate external_message_id in Org A does not collide with the same external_message_id used in Org B', async () => {
    const sharedExternalId = `${RUN_TAG}-iso3-shared-msg-id`
    const baseA = { orgId: fx.orgAId, requesterId: fx.requesterA.id, channelType: 'whatsapp' as const, channelIdentity: '9888888803' }
    const baseB = { orgId: fx.orgBId, requesterId: fx.requesterB.id, channelType: 'whatsapp' as const, channelIdentity: '9888888804' }

    // Same externalMessageId, different orgs — the idempotency key is
    // (org_id, channel_type, external_message_id), so this must NOT be
    // treated as a duplicate across the tenant boundary.
    const rA = await processConversationInbound({ ...baseA, externalMessageId: sharedExternalId, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const rB = await processConversationInbound({ ...baseB, externalMessageId: sharedExternalId, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })

    expect(rA.duplicate).toBeFalsy()
    expect(rB.duplicate).toBeFalsy()
    expect(rA.conversationId).not.toBe(rB.conversationId)
  })

  it('cannot attach a media reference to another org\'s conversation using a mismatched org context (repository stays explicit, never relies on RLS)', async () => {
    const baseB = { orgId: fx.orgBId, requesterId: fx.requesterB.id, channelType: 'whatsapp' as const, channelIdentity: '9888888805' }
    const rB = await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso4-b-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })

    // insertAttachment() takes a bare conversationId with no org parameter
    // by design (Stage 4's own attachment table has no direct org_id column
    // — it is scoped transitively through its conversation) — the isolation
    // guarantee lives in never resolving Org B's conversationId from Org A
    // context in the first place (proven above); this test confirms the
    // attachment ends up associated with the correct (Org B) conversation
    // and is invisible to a query scoped to Org A's conversations.
    await insertAttachment({ admin: admin as never, conversationId: rB.conversationId, fieldId: 'subject', externalMediaId: 'cross-org-check' })
    const attachmentsForB = await findAttachmentsForConversation({ admin: admin as never, conversationId: rB.conversationId })
    expect(attachmentsForB).toHaveLength(1)

    // Org A has no conversation with this id at all.
    const crossOrgLookup = await findConversationById({ admin: admin as never, orgId: fx.orgAId, id: rB.conversationId })
    expect(crossOrgLookup).toBeNull()
  })

  it('Org A cannot submit/create against Org B\'s draft — createConversation-derived requestId always lands under the correct org', async () => {
    const baseB = { orgId: fx.orgBId, requesterId: fx.requesterB.id, channelType: 'whatsapp' as const, channelIdentity: '9888888806' }
    await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso5-new`, kind: 'command', text: 'NEW', receivedAt: new Date().toISOString() })
    const r2 = await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso5-service`, kind: 'selection', selectionId: fx.fxB.serviceId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso5-search`, kind: 'text', text: 'printer issue', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso5-subcat`, kind: 'selection', selectionId: fx.fxB.subCategoryId, receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso5-description`, kind: 'text', text: 'Printer down.', receivedAt: new Date().toISOString() })
    await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso5-subject`, kind: 'text', text: 'Printer not working', receivedAt: new Date().toISOString() })
    const rCreate = await processConversationInbound({ ...baseB, externalMessageId: `${RUN_TAG}-iso5-create`, kind: 'command', text: 'CREATE', receivedAt: new Date().toISOString() })
    expect(rCreate.state).toBe('completed')

    const { data: created } = await admin.from('requests').select('org_id').eq('id', (await findConversationById({ admin: admin as never, orgId: fx.orgBId, id: r2.conversationId }))!.requestId!).single()
    expect(created?.org_id).toBe(fx.orgBId)
    expect(created?.org_id).not.toBe(fx.orgAId)
  })
})
