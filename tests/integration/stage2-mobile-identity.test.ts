/**
 * Stage 2 — mobile identity on the User Master + resolveUserByWhatsAppNumber().
 * Real local Supabase Postgres/Auth — same pattern as Stage 1/1.1's suites.
 *
 * Extended for migration 20240101000140 (many:1 — a profile can have
 * several mobile numbers, e.g. every cashier's phone for a shared store
 * login). Numbers now live in `profile_mobile_numbers`, not a `profiles`
 * column.
 *
 * Covers AC-2.1 through AC-2.11 (AC-2.12, the full regression run, is the
 * final `npx vitest run` at the end of this stage, not a test in this file).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, clientForToken, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg } from '../setup/cleanup-org'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateUserProfile, inviteUser, bulkCreateUsers, addMobileNumber, removeMobileNumber } from '@/lib/actions/admin/users'
import { resolveUserByWhatsAppNumber } from '@/lib/users/resolveWhatsAppUser'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

const ORG_A_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = `stage2-${Date.now()}`

type Fx = {
  orgAId: string
  orgBId: string
  adminA: TestUser
  createdUserIds: string[]
  cleanup: () => Promise<void>
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()

  const { data: orgB, error: orgBError } = await admin
    .from('organizations')
    .insert({ name: `Stage2 Org B ${RUN_TAG}`, slug: `stage2-org-b-${RUN_TAG}` })
    .select('id')
    .single()
  if (orgBError || !orgB) throw new Error(`[stage2 fixtures] org B: ${orgBError?.message}`)

  const adminA = await createTestUser('stage2-admin-a', 'Stage2 Admin A')
  await admin.from('profiles').update({ role: 'admin' }).eq('id', adminA.id)

  const createdUserIds: string[] = []

  return {
    orgAId: ORG_A_ID,
    orgBId: orgB.id,
    adminA,
    createdUserIds,
    cleanup: async () => {
      for (const id of [...createdUserIds, adminA.id]) {
        const { error } = await admin.auth.admin.deleteUser(id)
        if (error) console.error('[stage2 fixtures] cleanup: failed to delete test user', error.message)
      }
      await deleteTestOrg(admin, orgB.id)
    },
  }
}

/** Creates a profile directly (bypassing inviteUser) for fixtures that don't
 *  need to exercise the invite action itself — e.g. seeding an Org B user
 *  for the cross-org resolver test. `mobileNumber` (if given) is inserted
 *  into profile_mobile_numbers as this profile's one starting number. */
async function seedProfile(fx: Fx, opts: { orgId: string; fullName: string; mobileNumber?: string | null; isActive?: boolean; whatsappEnabled?: boolean }): Promise<string> {
  const admin = getAdmin()
  const user = await createTestUser(`stage2-seed-${fx.createdUserIds.length}`, opts.fullName)
  fx.createdUserIds.push(user.id)
  const { error } = await admin
    .from('profiles')
    .update({
      org_id: opts.orgId,
      full_name: opts.fullName,
      is_active: opts.isActive ?? true,
      whatsapp_enabled: opts.whatsappEnabled ?? true,
    })
    .eq('id', user.id)
  if (error) throw new Error(`[stage2] seedProfile: ${error.message}`)
  if (opts.mobileNumber) {
    const { error: mobileErr } = await admin
      .from('profile_mobile_numbers')
      .insert({ profile_id: user.id, org_id: opts.orgId, mobile_number: opts.mobileNumber })
    if (mobileErr) throw new Error(`[stage2] seedProfile mobile: ${mobileErr.message}`)
  }
  return user.id
}

/** All numbers currently on a profile, for assertions — order not
 *  guaranteed, so tests compare as a set. */
async function mobileNumbersOf(orgId: string, profileId: string): Promise<string[]> {
  const admin = getAdmin()
  const { data } = await admin.from('profile_mobile_numbers').select('mobile_number').eq('org_id', orgId).eq('profile_id', profileId)
  return (data ?? []).map((r: { mobile_number: string }) => r.mobile_number)
}

describe('Stage 2 — mobile identity & WhatsApp user resolution', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  // ── AC-2.1 / AC-2.3 — add mobile, normalization equivalence ──────────────

  it('AC-2.1/2.3: inviteUser stores the canonical 10-digit form regardless of how the admin typed it', async () => {
    actAs(fx.adminA)
    const result = await inviteUser({
      email: `stage2-invite-${RUN_TAG}@example.test`,
      full_name: 'Rahul Kumar',
      role: 'user',
      mobile_number: '+91 98765 43210',
      whatsapp_enabled: true,
    })
    expect(result.error).toBeUndefined()

    const { data: created } = await admin.from('profiles').select('id, whatsapp_enabled').eq('full_name', 'Rahul Kumar').eq('org_id', fx.orgAId).single()
    expect(created?.whatsapp_enabled).toBe(true)
    if (created) fx.createdUserIds.push(created.id)
    expect(await mobileNumbersOf(fx.orgAId, created!.id)).toEqual(['9876543210'])
  })

  it('inviteUser rejects a malformed mobile number and creates no auth account at all', async () => {
    actAs(fx.adminA)
    const email = `stage2-invalid-mobile-${RUN_TAG}@example.test`
    const result = await inviteUser({ email, full_name: 'Bad Mobile', role: 'user', mobile_number: '12345' })
    expect(result.error).toBeTruthy()

    const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const found = (authList?.users ?? []).find((u) => u.email === email)
    expect(found).toBeUndefined()
  })

  // ── AC-2.4 — uniqueness within org ────────────────────────────────────────

  it('AC-2.4: inviteUser rejects a mobile already registered to another user in the same org, before creating an auth account', async () => {
    actAs(fx.adminA)
    const first = await inviteUser({
      email: `stage2-dup-owner-${RUN_TAG}@example.test`,
      full_name: 'Amit Owner', role: 'user', mobile_number: '9812345678',
    })
    expect(first.error).toBeUndefined()
    const { data: owner } = await admin.from('profiles').select('id').eq('full_name', 'Amit Owner').eq('org_id', fx.orgAId).single()
    if (owner) fx.createdUserIds.push(owner.id)

    const dupEmail = `stage2-dup-attempt-${RUN_TAG}@example.test`
    const second = await inviteUser({
      email: dupEmail, full_name: 'Someone Else', role: 'user',
      mobile_number: '+91-98123-45678', // same number, different formatting — must still collide
    })
    expect(second.error).toBe('This mobile number is already registered to another user in this organization.')

    const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 })
    expect((authList?.users ?? []).some((u) => u.email === dupEmail)).toBe(false)
  })

  // ── AC-2.2 — add / remove mobile numbers, many:1 ──────────────────────────

  it('AC-2.2: addMobileNumber/removeMobileNumber can add and remove a user\'s mobile numbers', async () => {
    const userId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Edit Target', mobileNumber: null })

    actAs(fx.adminA)
    const r1 = await addMobileNumber(userId, '9700000001')
    expect(r1.error).toBeUndefined()
    expect(await mobileNumbersOf(fx.orgAId, userId)).toEqual(['9700000001'])

    const r2 = await addMobileNumber(userId, '9700000002')
    expect(r2.error).toBeUndefined()
    expect(await mobileNumbersOf(fx.orgAId, userId)).toEqual(expect.arrayContaining(['9700000001', '9700000002']))

    const r3 = await removeMobileNumber(userId, '9700000001')
    expect(r3.error).toBeUndefined()
    expect(await mobileNumbersOf(fx.orgAId, userId)).toEqual(['9700000002'])

    const r4 = await removeMobileNumber(userId, '9700000002')
    expect(r4.error).toBeUndefined()
    expect(await mobileNumbersOf(fx.orgAId, userId)).toEqual([])
  })

  it('a profile can have several numbers at once, and removing one does not affect the others', async () => {
    const userId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Store Account (Many Numbers)', mobileNumber: null })

    actAs(fx.adminA)
    for (const n of ['9700000101', '9700000102', '9700000103']) {
      const r = await addMobileNumber(userId, n)
      expect(r.error).toBeUndefined()
    }
    expect(await mobileNumbersOf(fx.orgAId, userId)).toEqual(expect.arrayContaining(['9700000101', '9700000102', '9700000103']))

    // Every number resolves to the SAME profile (the shared store-account scenario).
    for (const n of ['9700000101', '9700000102', '9700000103']) {
      const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: n })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.profile.profileId).toBe(userId)
    }

    const removeResult = await removeMobileNumber(userId, '9700000102')
    expect(removeResult.error).toBeUndefined()

    // The removed number no longer resolves; the other two are untouched.
    expect(await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000102' })).toEqual({ ok: false, reason: 'not_registered' })
    for (const n of ['9700000101', '9700000103']) {
      const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: n })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.profile.profileId).toBe(userId)
    }
  })

  it('a number removed from one profile can then be added to a different profile and resolves there', async () => {
    const profileA = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Moved Number Origin', mobileNumber: '9700000110' })
    const profileB = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Moved Number Destination', mobileNumber: null })

    actAs(fx.adminA)
    const removeResult = await removeMobileNumber(profileA, '9700000110')
    expect(removeResult.error).toBeUndefined()

    const addResult = await addMobileNumber(profileB, '9700000110')
    expect(addResult.error).toBeUndefined()

    const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000110' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.profile.profileId).toBe(profileB)
  })

  it('addMobileNumber rejects a number already on a different profile, but gives a distinct message for re-adding a number already on the SAME profile', async () => {
    const ownerId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Self Save', mobileNumber: '9700000010' })
    const otherId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Other Owner', mobileNumber: '9700000011' })

    actAs(fx.adminA)
    // Re-adding a number the profile already has is a friendly, distinct
    // error — never silently a no-op, and never the generic cross-user
    // duplicate message.
    const selfReAdd = await addMobileNumber(ownerId, '9700000010')
    expect(selfReAdd.error).toBe('This number is already added to this user.')

    // Attempting to take someone else's number must fail with the
    // cross-user duplicate message.
    const stealAttempt = await addMobileNumber(ownerId, '9700000011')
    expect(stealAttempt.error).toBe('This mobile number is already registered to another user in this organization.')
    void otherId
  })

  // ── AC-2.5 — WhatsApp toggle independence ─────────────────────────────────

  it('AC-2.5: disabling whatsapp_enabled does not touch mobile numbers, is_active, or normal DESK account state', async () => {
    const userId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Toggle Target', mobileNumber: '9700000020', whatsappEnabled: true })

    actAs(fx.adminA)
    const r = await updateUserProfile(userId, { whatsapp_enabled: false })
    expect(r.error).toBeUndefined()

    const row = (await admin.from('profiles').select('is_active, whatsapp_enabled').eq('id', userId).single()).data
    expect(row?.whatsapp_enabled).toBe(false)
    expect(row?.is_active).toBe(true) // untouched
    expect(await mobileNumbersOf(fx.orgAId, userId)).toEqual(['9700000020']) // untouched
  })

  // ── Resolver: AC-2.6, AC-2.7, AC-2.8 ──────────────────────────────────────

  it('AC-2.7: a valid, active, WhatsApp-enabled user resolves with the expected identity shape', async () => {
    const userId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Resolvable User', mobileNumber: '9700000030' })
    const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000030' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected resolution')
    expect(result.profile.profileId).toBe(userId)
    expect(result.profile.orgId).toBe(fx.orgAId)
    expect(result.profile.fullName).toBe('Resolvable User')
    expect(result.profile).toHaveProperty('employeeId')
    expect(result.profile).toHaveProperty('role')
    expect(result.profile).toHaveProperty('storeId')
    expect(result.profile).toHaveProperty('departmentId')
    expect(result.profile).toHaveProperty('locationId')
  })

  it('resolves identically regardless of input formatting (normalization equivalence via the resolver, not just the utility)', async () => {
    await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Format Equivalence User', mobileNumber: '9700000031' })
    const variants = ['9700000031', '09700000031', '919700000031', '+919700000031', '+91 97000 00031']
    for (const variant of variants) {
      const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: variant })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.profile.fullName).toBe('Format Equivalence User')
    }
  })

  it('an unregistered number is rejected as not_registered', async () => {
    const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9799999999' })
    expect(result).toEqual({ ok: false, reason: 'not_registered' })
  })

  it('a malformed input is rejected as invalid_phone, without touching the database', async () => {
    const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: 'not-a-number' })
    expect(result).toEqual({ ok: false, reason: 'invalid_phone' })
  })

  it('AC-2.6: an inactive user is rejected as inactive, even with a valid registered mobile', async () => {
    await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Inactive User', mobileNumber: '9700000040', isActive: false })
    const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000040' })
    expect(result).toEqual({ ok: false, reason: 'inactive' })
  })

  it('a whatsapp_enabled=false user is rejected as whatsapp_disabled, then resolves again once re-enabled', async () => {
    const userId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Disabled User', mobileNumber: '9700000041', whatsappEnabled: false })
    const before = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000041' })
    expect(before).toEqual({ ok: false, reason: 'whatsapp_disabled' })

    await admin.from('profiles').update({ whatsapp_enabled: true }).eq('id', userId)
    const after = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000041' })
    expect(after.ok).toBe(true)
  })

  it('a user with no mobile number never resolves (not_registered)', async () => {
    await seedProfile(fx, { orgId: fx.orgAId, fullName: 'No Mobile User', mobileNumber: null })
    // There's no number to even attempt — confirms the absence itself is a
    // clean "not registered" outcome elsewhere, not a crash/exception path.
    const result = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000099' })
    expect(result).toEqual({ ok: false, reason: 'not_registered' })
  })

  it('AC-2.8: a service-role lookup for Org B cannot resolve an Org A user with the same number', async () => {
    await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Org A Owner', mobileNumber: '9700000050' })
    const crossOrgResult = await resolveUserByWhatsAppNumber({ orgId: fx.orgBId, phoneNumber: '9700000050', client: admin })
    expect(crossOrgResult).toEqual({ ok: false, reason: 'not_registered' })

    // Control: the exact same number DOES resolve when queried under its
    // own org — proves the cross-org test above failed because of tenant
    // isolation, not because the number itself was somehow wrong.
    const sameOrgResult = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000050', client: admin })
    expect(sameOrgResult.ok).toBe(true)
  })

  it('the same normalized number CAN independently exist in two different orgs without conflict', async () => {
    await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Org A Shared Number', mobileNumber: '9700000060' })
    await seedProfile(fx, { orgId: fx.orgBId, fullName: 'Org B Shared Number', mobileNumber: '9700000060' })

    const resultA = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9700000060' })
    const resultB = await resolveUserByWhatsAppNumber({ orgId: fx.orgBId, phoneNumber: '9700000060' })
    expect(resultA.ok).toBe(true)
    expect(resultB.ok).toBe(true)
    if (resultA.ok && resultB.ok) {
      expect(resultA.profile.fullName).toBe('Org A Shared Number')
      expect(resultB.profile.fullName).toBe('Org B Shared Number')
      expect(resultA.profile.profileId).not.toBe(resultB.profile.profileId)
    }
  })

  // ── AC-2.9 — the headline mobile-change test ──────────────────────────────

  it('AC-2.9: changing the User Master mobile (remove old, add new) immediately unauthorizes the old number and authorizes the new one', async () => {
    const userId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Rahul Mobile Change', mobileNumber: '9876500000' })

    const beforeOld = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9876500000' })
    expect(beforeOld.ok).toBe(true)
    if (beforeOld.ok) expect(beforeOld.profile.profileId).toBe(userId)

    actAs(fx.adminA)
    const removeResult = await removeMobileNumber(userId, '9876500000')
    expect(removeResult.error).toBeUndefined()
    const addResult = await addMobileNumber(userId, '9812345000')
    expect(addResult.error).toBeUndefined()

    const afterOld = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9876500000' })
    expect(afterOld).toEqual({ ok: false, reason: 'not_registered' })

    const afterNew = await resolveUserByWhatsAppNumber({ orgId: fx.orgAId, phoneNumber: '9812345000' })
    expect(afterNew.ok).toBe(true)
    if (afterNew.ok) expect(afterNew.profile.profileId).toBe(userId)
  })

  // ── AC-2.10 — bulk import ─────────────────────────────────────────────────

  describe('bulk import', () => {
    it('creates users with mobile_number and whatsapp_enabled set from CSV columns', async () => {
      actAs(fx.adminA)
      const result = await bulkCreateUsers([
        { full_name: 'Bulk One', email: `stage2-bulk-one-${RUN_TAG}@example.test`, mobile_number: '9700001001', whatsapp_enabled: 'true' },
        { full_name: 'Bulk Two', email: `stage2-bulk-two-${RUN_TAG}@example.test`, mobile_number: '', whatsapp_enabled: '' }, // empty mobile allowed
      ])
      expect(result.data?.imported).toBe(2)
      expect(result.data?.errors).toEqual([])

      const { data: one } = await admin.from('profiles').select('id, whatsapp_enabled').eq('full_name', 'Bulk One').eq('org_id', fx.orgAId).single()
      expect(one?.whatsapp_enabled).toBe(true)
      if (one) fx.createdUserIds.push(one.id)
      expect(await mobileNumbersOf(fx.orgAId, one!.id)).toEqual(['9700001001'])

      const { data: two } = await admin.from('profiles').select('id, whatsapp_enabled').eq('full_name', 'Bulk Two').eq('org_id', fx.orgAId).single()
      expect(two?.whatsapp_enabled).toBe(true) // schema default, column left unset
      if (two) fx.createdUserIds.push(two.id)
      expect(await mobileNumbersOf(fx.orgAId, two!.id)).toEqual([])
    })

    it('rejects an invalid mobile number row without blocking the rest of the batch', async () => {
      actAs(fx.adminA)
      const goodEmail = `stage2-bulk-good-${RUN_TAG}@example.test`
      const badEmail = `stage2-bulk-bad-${RUN_TAG}@example.test`
      const result = await bulkCreateUsers([
        { full_name: 'Bulk Bad Mobile', email: badEmail, mobile_number: '123' },
        { full_name: 'Bulk Good Row', email: goodEmail, mobile_number: '9700001002' },
      ])
      expect(result.data?.imported).toBe(1)
      expect(result.data?.errors.some((e) => e.startsWith('Row 2:'))).toBe(true)

      const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 })
      expect((authList?.users ?? []).some((u) => u.email === badEmail)).toBe(false)
      const good = (authList?.users ?? []).find((u) => u.email === goodEmail)
      if (good) fx.createdUserIds.push(good.id)
    })

    it('detects an in-CSV duplicate mobile (comparing normalized values) and blocks BOTH rows', async () => {
      actAs(fx.adminA)
      const emailA = `stage2-bulk-csvdup-a-${RUN_TAG}@example.test`
      const emailB = `stage2-bulk-csvdup-b-${RUN_TAG}@example.test`
      const result = await bulkCreateUsers([
        { full_name: 'CSV Dup A', email: emailA, mobile_number: '9700001003' },
        { full_name: 'CSV Dup B', email: emailB, mobile_number: '+91 97000 01003' }, // same number, different formatting
      ])
      expect(result.data?.imported).toBe(0)
      expect(result.data?.errors.some((e) => e.includes('Row 2') && e.includes('same mobile number as Row 3'))).toBe(true)
      expect(result.data?.errors.some((e) => e.includes('Row 3') && e.includes('same mobile number as Row 2'))).toBe(true)

      const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 })
      expect((authList?.users ?? []).some((u) => u.email === emailA || u.email === emailB)).toBe(false)
    })

    it('rejects a row whose mobile is already registered to an existing profile in this org', async () => {
      const existingId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Existing Bulk Owner', mobileNumber: '9700001004' })
      void existingId

      actAs(fx.adminA)
      const email = `stage2-bulk-existing-dup-${RUN_TAG}@example.test`
      const result = await bulkCreateUsers([
        { full_name: 'Bulk Conflicts With Existing', email, mobile_number: '9700001004' },
      ])
      expect(result.data?.imported).toBe(0)
      expect(result.data?.errors.some((e) => e.includes('already assigned to another user'))).toBe(true)
    })

    it('rejects an unparseable whatsapp_enabled value', async () => {
      actAs(fx.adminA)
      const email = `stage2-bulk-bad-whatsapp-${RUN_TAG}@example.test`
      const result = await bulkCreateUsers([
        { full_name: 'Bad WhatsApp Flag', email, whatsapp_enabled: 'maybe' },
      ])
      expect(result.data?.imported).toBe(0)
      expect(result.data?.errors.some((e) => e.includes('whatsapp_enabled'))).toBe(true)
    })
  })

  // ── AC-2.11 — existing no-mobile users are unaffected ─────────────────────

  it('AC-2.11: a profile with no mobile number behaves normally in every other respect (read/update unrelated fields)', async () => {
    const userId = await seedProfile(fx, { orgId: fx.orgAId, fullName: 'Legacy No-Mobile User', mobileNumber: null })
    actAs(fx.adminA)
    const result = await updateUserProfile(userId, { job_title: 'Legacy Role' })
    expect(result.error).toBeUndefined()
    const row = (await admin.from('profiles').select('job_title').eq('id', userId).single()).data
    expect(row?.job_title).toBe('Legacy Role')
    expect(await mobileNumbersOf(fx.orgAId, userId)).toEqual([])
  })
})
