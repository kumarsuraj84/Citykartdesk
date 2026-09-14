/**
 * Stage 3.2 — deterministic new-user org assignment + leak-proof cleanup.
 *
 * Proves the two fixes made this stage against the REAL local Postgres
 * instance, not by inspecting source code alone:
 *
 *   1. handle_new_user() no longer depends on an unordered
 *      `SELECT id FROM organizations LIMIT 1` — it now deterministically
 *      picks the oldest org (`ORDER BY created_at ASC, id ASC`), which is
 *      always the real seed org, regardless of how many newer stray test
 *      orgs exist at the time.
 *   2. deleteTestOrg() (tests/setup/cleanup-org.ts) actually removes both
 *      the organization row and its auto-created global_sla_config row —
 *      verified by querying afterward, not by the delete call returning no
 *      error (which every affected fixture was already doing, silently,
 *      before this stage).
 *
 * Also proves the two are related: a caller that DOES supply explicit org
 * context (the real bulkCreateUsers()/inviteUser() mechanism — create the
 * auth user, then immediately correct profiles.org_id) always lands in the
 * intended org, never a stray one, regardless of how many stray orgs exist
 * at the time — this is the actual tenant-safety guarantee the product
 * relies on; handle_new_user()'s own pick is never what's persisted for any
 * real caller.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAdmin, createTestUser, clientForToken, type TestUser } from '../setup/fixtures-d03'
import { deleteTestOrg, orgExists, globalSlaConfigExists } from '../setup/cleanup-org'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { bulkCreateUsers } from '@/lib/actions/admin/users'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

const SEED_ORG_ID = '00000000-0000-0000-0000-000000000001'
const RUN_TAG = `stage3-2-org-${Date.now()}`

type Fx = {
  strayOrgIds: string[]
  adminInSeedOrg: TestUser
  cleanup: () => Promise<void>
}

/** Creates a throwaway org, newer than the seed org by construction (it's
 *  created after this whole test session's earlier setup, so `created_at`
 *  is later) — used to prove handle_new_user()'s ORDER BY isn't fooled by
 *  its mere existence. */
async function createStrayOrg(admin: ReturnType<typeof getAdmin>, label: string): Promise<string> {
  const { data, error } = await admin.from('organizations').insert({ name: `${label} ${RUN_TAG}`, slug: `${label.toLowerCase().replace(/\s+/g, '-')}-${RUN_TAG}` }).select('id').single()
  if (error || !data) throw new Error(`[stage3.2 org fixtures] ${label}: ${error?.message}`)
  return data.id
}

async function setup(): Promise<Fx> {
  const admin = getAdmin()
  const strayOrgIds = [await createStrayOrg(admin, 'Stage3.2 Stray Org B'), await createStrayOrg(admin, 'Stage3.2 Stray Org C')]

  const adminInSeedOrg = await createTestUser('stage3-2-admin-seed', 'Stage3.2 Admin Seed')
  await admin.from('profiles').update({ role: 'admin', org_id: SEED_ORG_ID }).eq('id', adminInSeedOrg.id)

  return {
    strayOrgIds,
    adminInSeedOrg,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(adminInSeedOrg.id)
      for (const id of strayOrgIds) await deleteTestOrg(admin, id)
    },
  }
}

describe('Stage 3.2 — deterministic org assignment & leak-proof cleanup', () => {
  let fx: Fx
  const admin = getAdmin()

  beforeAll(async () => {
    fx = await setup()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  describe('Step 6 — leak-prevention: deleteTestOrg() proven by querying afterward', () => {
    it('removes both the organization row and its global_sla_config row, not merely "no error"', async () => {
      const orgId = await createStrayOrg(admin, 'Stage3.2 Leak Check Org')

      // Before: both rows genuinely exist (the seed_org_sla_config trigger fired).
      expect(await orgExists(admin, orgId)).toBe(true)
      expect(await globalSlaConfigExists(admin, orgId)).toBe(true)

      await deleteTestOrg(admin, orgId)

      // After: both are actually gone — queried, not assumed from a clean delete() call.
      expect(await orgExists(admin, orgId)).toBe(false)
      expect(await globalSlaConfigExists(admin, orgId)).toBe(false)
    })

    it('deleteTestOrg() throws (does not silently swallow) if an org-scoped row still blocks the delete', async () => {
      const orgId = await createStrayOrg(admin, 'Stage3.2 Blocked Org')
      const { data: team, error } = await admin
        .from('teams')
        .insert({ name: `Blocking Team ${RUN_TAG}`, slug: `blocking-team-${RUN_TAG}`, prefix: `BLK`, department_id: '10000000-0000-0000-0000-000000000001', org_id: orgId })
        .select('id')
        .single()
      if (error || !team) throw new Error(`setup: ${error?.message}`)

      await expect(deleteTestOrg(admin, orgId)).rejects.toThrow(/failed to delete test org/)

      // Clean up properly so this test doesn't itself leak.
      await admin.from('teams').delete().eq('id', team.id)
      await deleteTestOrg(admin, orgId)
      expect(await orgExists(admin, orgId)).toBe(false)
    })
  })

  describe('Step 7 / AC-3.2.4 — handle_new_user() no longer depends on unordered org selection', () => {
    it('a raw new auth user (no follow-up correction) deterministically lands in the seed org, not a stray one — repeated 3x', async () => {
      for (let i = 0; i < 3; i++) {
        const user = await createTestUser(`stage3-2-detcheck-${i}`, `Stage3.2 Det Check ${i}`)
        const { data: profile } = await admin.from('profiles').select('org_id').eq('id', user.id).single()
        expect(profile?.org_id).toBe(SEED_ORG_ID)
        expect(profile?.org_id).not.toBe(fx.strayOrgIds[0])
        expect(profile?.org_id).not.toBe(fx.strayOrgIds[1])
        await admin.auth.admin.deleteUser(user.id)
      }
    })
  })

  describe('Step 10 / AC-3.2.5 — explicit org assignment remains tenant-safe regardless of stray orgs', () => {
    it('bulkCreateUsers() (the real product mechanism) lands a new user in the ACTING ADMIN\'s org, never a stray org', async () => {
      actAs(fx.adminInSeedOrg)
      const email = `stage3-2-bulk-${RUN_TAG}@example.test`
      const result = await bulkCreateUsers([{ full_name: 'Stage3.2 Bulk User', email }])
      expect(result.data?.imported).toBe(1)

      const { data: created } = await admin.from('profiles').select('id, org_id').eq('full_name', 'Stage3.2 Bulk User').single()
      expect(created?.org_id).toBe(SEED_ORG_ID)
      expect(created?.org_id).not.toBe(fx.strayOrgIds[0])
      expect(created?.org_id).not.toBe(fx.strayOrgIds[1])
      if (created) await admin.auth.admin.deleteUser(created.id)
    })
  })

  describe('Step 8 / AC-3.2.6 — repeated create/cleanup cycles do not accumulate stray organizations', () => {
    it('3 consecutive create-then-cleanup cycles return the org count to the same baseline each time', async () => {
      const { count: baseline } = await admin.from('organizations').select('id', { count: 'exact', head: true })

      for (let i = 0; i < 3; i++) {
        const orgId = await createStrayOrg(admin, `Stage3.2 Cycle Org ${i}`)
        const { count: duringCycle } = await admin.from('organizations').select('id', { count: 'exact', head: true })
        expect(duringCycle).toBe((baseline ?? 0) + 1)

        await deleteTestOrg(admin, orgId)

        const { count: afterCycle } = await admin.from('organizations').select('id', { count: 'exact', head: true })
        expect(afterCycle).toBe(baseline)
      }
    })
  })
})
