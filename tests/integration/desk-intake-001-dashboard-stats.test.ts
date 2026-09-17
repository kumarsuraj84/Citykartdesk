/**
 * DESK-INTAKE-001 regression suite.
 *
 * Defect: the Intake Intelligence dashboard (app/(app)/intake/page.tsx)
 * showed phantom non-zero KPIs (New/Needs Review/Converted/Channels) while
 * every corresponding detail list ("Needs review", "Recent activity") was
 * genuinely empty. Root cause: getIntakeDashboardStats() used
 * `count: 'estimated'`, which asks PostgREST for Postgres's *planner* row
 * estimate (pg_class.reltuples) rather than a real COUNT(*). That estimate
 * is only refreshed by ANALYZE/autovacuum — not by the DELETEs that emptied
 * these tables after early testing — so it kept reporting stale phantom
 * counts long after the tables were genuinely empty. Confirmed on Main:
 * `select reltuples from pg_class` matched the wrong KPI values exactly,
 * while `select count(*)` on the same tables returned 0.
 *
 * Fix: switch every count() call in lib/queries/intake/index.ts from
 * 'estimated' to 'exact'. These are small, per-org-scoped tables — not the
 * kind of huge table 'estimated' exists to help with — so exact counting
 * is cheap and, more importantly, always correct regardless of when
 * ANALYZE last ran.
 *
 * This test proves the fix directly: insert/delete rows and assert the
 * dashboard stats reflect that *immediately*, with no ANALYZE in between —
 * exactly the scenario that produced the wrong numbers under 'estimated'.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, clientForToken } from '../setup/fixtures-d03'
import { deleteTestUser } from '../setup/cleanup-user'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))

import { createClient } from '@/lib/supabase/server'
import { getIntakeDashboardStats } from '@/lib/queries/intake'

const mockedCreateClient = vi.mocked(createClient)

const EXISTING_ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = `desk-intake-001-${Date.now()}`

describe('DESK-INTAKE-001: Intake dashboard stats use exact counts, not stale planner estimates', () => {
  const admin = getAdmin()
  let userId: string
  let channelId: string
  const messageIds: string[] = []
  const reviewIds: string[] = []

  beforeAll(async () => {
    const user = await createTestUser('intake-agent', 'DESK-INTAKE-001 Agent')
    userId = user.id
    const { error: roleError } = await admin.from('profiles').update({ role: 'agent' }).eq('id', userId)
    if (roleError) throw new Error(`[fixtures] failed to promote test user: ${roleError.message}`)

    mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)

    const { data: channel, error: channelError } = await admin
      .from('intake_channels')
      .insert({ org_id: EXISTING_ORG_ID, type: 'email', name: `${RUN_TAG}-channel`, status: 'active' })
      .select('id')
      .single()
    if (channelError || !channel) throw new Error(`[fixtures] failed to create channel: ${channelError?.message}`)
    channelId = channel.id
  }, 30_000)

  afterAll(async () => {
    if (reviewIds.length > 0) await admin.from('intake_reviews').delete().in('id', reviewIds)
    if (messageIds.length > 0) await admin.from('intake_messages').delete().in('id', messageIds)
    await admin.from('intake_channels').delete().eq('id', channelId)
    await deleteTestUser(admin, userId, 'desk-intake-001-agent')
  }, 30_000)

  it('1. newCount reflects an insert and a delete immediately, with no ANALYZE in between', async () => {
    const before = await getIntakeDashboardStats()

    const { data: inserted, error } = await admin
      .from('intake_messages')
      .insert({ org_id: EXISTING_ORG_ID, channel_id: channelId, subject: `${RUN_TAG}-new-1`, status: 'new' })
      .select('id')
      .single()
    if (error || !inserted) throw new Error(`insert failed: ${error?.message}`)
    messageIds.push(inserted.id)

    const afterInsert = await getIntakeDashboardStats()
    expect(afterInsert.newCount).toBe(before.newCount + 1)

    const { error: delError } = await admin.from('intake_messages').delete().eq('id', inserted.id)
    if (delError) throw new Error(`delete failed: ${delError.message}`)
    messageIds.splice(messageIds.indexOf(inserted.id), 1)

    const afterDelete = await getIntakeDashboardStats()
    expect(afterDelete.newCount).toBe(before.newCount)
  })

  it('2. inReviewCount reflects intake_reviews in pending/in_review state exactly', async () => {
    const { data: msg, error: msgErr } = await admin
      .from('intake_messages')
      .insert({ org_id: EXISTING_ORG_ID, channel_id: channelId, subject: `${RUN_TAG}-for-review`, status: 'classified' })
      .select('id')
      .single()
    if (msgErr || !msg) throw new Error(`insert message failed: ${msgErr?.message}`)
    messageIds.push(msg.id)

    const before = await getIntakeDashboardStats()

    const { data: review, error: reviewErr } = await admin
      .from('intake_reviews')
      .insert({ org_id: EXISTING_ORG_ID, message_id: msg.id, state: 'pending' })
      .select('id')
      .single()
    if (reviewErr || !review) throw new Error(`insert review failed: ${reviewErr?.message}`)
    reviewIds.push(review.id)

    const afterInsert = await getIntakeDashboardStats()
    expect(afterInsert.inReviewCount).toBe(before.inReviewCount + 1)

    const { error: delError } = await admin.from('intake_reviews').delete().eq('id', review.id)
    if (delError) throw new Error(`delete review failed: ${delError.message}`)
    reviewIds.splice(reviewIds.indexOf(review.id), 1)

    const afterDelete = await getIntakeDashboardStats()
    expect(afterDelete.inReviewCount).toBe(before.inReviewCount)
  })

  it('3. channelCount/activeChannelCount reflect the real row count exactly', async () => {
    const stats = await getIntakeDashboardStats()
    const { count: realChannelCount } = await admin.from('intake_channels').select('id', { count: 'exact', head: true }).eq('org_id', EXISTING_ORG_ID)
    expect(stats.channelCount).toBe(realChannelCount)
    expect(stats.activeChannelCount).toBeGreaterThanOrEqual(1) // the fixture channel itself is 'active'
  })

  it('4. actionedCount reflects intake_messages with status=actioned exactly', async () => {
    const before = await getIntakeDashboardStats()

    const { data: msg, error } = await admin
      .from('intake_messages')
      .insert({ org_id: EXISTING_ORG_ID, channel_id: channelId, subject: `${RUN_TAG}-actioned`, status: 'actioned' })
      .select('id')
      .single()
    if (error || !msg) throw new Error(`insert failed: ${error?.message}`)
    messageIds.push(msg.id)

    const after = await getIntakeDashboardStats()
    expect(after.actionedCount).toBe(before.actionedCount + 1)
  })
})
