/**
 * Consolidated remediation — item 6: Intake module gate inconsistency.
 *
 * Root cause: getEnabledModules() is checked server-side in
 * lib/actions/{requests,tasks,projects}.ts before doing anything else, but
 * lib/actions/intake/*.ts never called it at all — Intake was only gated at
 * the UI/nav layer (Sidebar/MobileNav hiding the links). A disabled-module
 * org's users could still invoke any Intake Server Action directly (a
 * hidden nav link doesn't disable the 'use server' export it points to).
 *
 * Fix: lib/actions/moduleGuard.ts's requireModuleEnabled() is now called at
 * the top of every externally-callable Intake action, mirroring the
 * existing tasks/requests/projects pattern. These tests mock
 * getCurrentProfile/getEnabledModules (no real DB) and assert that with
 * Intake disabled for the org, a representative action from each of the
 * nine intake action files returns the module-disabled error and never
 * reaches a database call — proving the module is actually unusable via a
 * direct Server Action call, not just hidden from navigation.
 *
 * Per the remediation brief: "Do not enable Intake in this environment" —
 * this suite proves the disabled path only; it does not flip Intake on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PROFILE = {
  id: 'user-1',
  org_id: 'org-1',
  role: 'admin',
  team_members: [],
} as unknown as import('@/types').ProfileWithTeams

const { getCurrentProfileMock, getEnabledModulesMock } = vi.hoisted(() => ({
  getCurrentProfileMock: vi.fn(),
  getEnabledModulesMock: vi.fn(),
}))

vi.mock('@/lib/queries/profiles', () => ({
  getCurrentProfile: getCurrentProfileMock,
  getEnabledModules: getEnabledModulesMock,
}))

// A Supabase client stand-in whose every method throws — if any intake
// action reaches the database despite Intake being disabled, the test fails
// loudly right there instead of silently passing on an unrelated mock gap.
function dbShouldNotBeTouched() {
  const trap = new Proxy(() => {}, {
    get() {
      throw new Error('Database was reached despite the Intake module being disabled — guard did not short-circuit.')
    },
  })
  return trap
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => dbShouldNotBeTouched() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => dbShouldNotBeTouched() }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

beforeEach(() => {
  getCurrentProfileMock.mockReset().mockResolvedValue(PROFILE)
  // Every module EXCEPT intake is enabled — proves this is specifically the
  // intake gate firing, not a blanket "nothing is enabled" fixture artifact.
  getEnabledModulesMock.mockReset().mockResolvedValue(['requests', 'tasks', 'projects', 'approvals'])
})

describe('Intake Server Actions refuse to run when the intake module is disabled', () => {
  it('channels.ts createChannel is blocked', async () => {
    const { createChannel } = await import('@/lib/actions/intake/channels')
    const result = await createChannel({ name: 'Support inbox', type: 'email' })
    expect(result.error).toBe('The intake module is not enabled for your organisation.')
  })

  it('communication.ts addNote is blocked', async () => {
    const { addNote } = await import('@/lib/actions/intake/communication')
    const result = await addNote('msg-1', 'a note')
    expect(result.error).toBe('The intake module is not enabled for your organisation.')
  })

  it('flags.ts starReview is blocked', async () => {
    const { starReview } = await import('@/lib/actions/intake/flags')
    const result = await starReview('review-1', true)
    expect(result.error).toBe('The intake module is not enabled for your organisation.')
  })

  it('reviews.ts claimReview is blocked', async () => {
    const { claimReview } = await import('@/lib/actions/intake/reviews')
    const result = await claimReview('review-1')
    expect(result.error).toBe('The intake module is not enabled for your organisation.')
  })

  it('rules.ts createIntakeRule is blocked', async () => {
    const { createIntakeRule } = await import('@/lib/actions/intake/rules')
    const result = await createIntakeRule({
      name: 'Test rule', enabled: true, match_field: 'subject', match_keywords: ['urgent'],
      match_regex: null, output_type: 'task', output_department: null, output_category: null,
      output_subcategory: null, output_priority: 'high', weight: 5,
    })
    expect(result.error).toBe('The intake module is not enabled for your organisation.')
  })

  it('work.ts approveAndCreate is blocked', async () => {
    const { approveAndCreate } = await import('@/lib/actions/intake/work')
    const result = await approveAndCreate('review-1', { final_type: 'task' } as never, { type: 'ignore' } as never)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error?: string }).error).toBe('The intake module is not enabled for your organisation.')
  })

  it('brief.ts generateEmailBrief is blocked', async () => {
    const { generateEmailBrief } = await import('@/lib/actions/intake/brief')
    const result = await generateEmailBrief('Subject', 'Body text', 'sender@example.test')
    expect(result.error).toBe('The intake module is not enabled for your organisation.')
    expect(result.brief).toBeNull()
  })

  it('detail.ts loadReviewDetail is blocked (returns null, its existing "not found/unauthorized" shape)', async () => {
    const { loadReviewDetail } = await import('@/lib/actions/intake/detail')
    const result = await loadReviewDetail('review-1')
    expect(result).toBeNull()
  })

  it('pipeline.ts testStage2 and reclassifyBacklog are blocked', async () => {
    const { testStage2, reclassifyBacklog, getReclassifyProgress } = await import('@/lib/actions/intake/pipeline')
    await expect(testStage2()).resolves.toMatchObject({ ok: false, error: 'The intake module is not enabled for your organisation.' })
    await expect(reclassifyBacklog()).resolves.toMatchObject({ ok: false, error: 'The intake module is not enabled for your organisation.' })
    // getReclassifyProgress has no error field in its return shape (a pure
    // stats snapshot) — disabled-module behaves the same as
    // no-profile/wrong-role: the pre-existing empty/zeroed snapshot.
    await expect(getReclassifyProgress()).resolves.toMatchObject({ totalMessages: 0, classified: 0 })
  })

  it('control case: with intake enabled, the guard passes and the (mocked) DB call is what fails instead — proving the guard is the thing under test, not an unrelated auth failure', async () => {
    getEnabledModulesMock.mockResolvedValue(['requests', 'tasks', 'projects', 'approvals', 'intake'])
    const { starReview } = await import('@/lib/actions/intake/flags')
    // With the module enabled, execution proceeds past the guard and hits
    // the trapped DB mock, which throws — confirming the module-disabled
    // error in the tests above came from the guard, not from some other
    // early return.
    await expect(starReview('review-1', true)).rejects.toThrow('Database was reached')
  })
})
