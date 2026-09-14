/**
 * D-04 — project/milestone object-level authorization.
 *
 * Static audit + runtime reproduction: addProjectMember(), removeProjectMember(),
 * createMilestone(), and updateMilestone() in lib/actions/projects.ts checked
 * only that the caller was authenticated (and, for two of them, that they had
 * an org_id) — never whether the caller had anything to do with the specific
 * project being mutated. The matching RLS policies (project_members_insert/
 * delete, milestones_insert/update) are role-only (agent-tier and above),
 * with no project-scoping predicate either — so an unrelated agent in a
 * completely different team could add/remove members or create/update a
 * milestone on any project in the org.
 *
 * Fix: each of the four actions now calls canAccessProject() (in
 * lib/actions/projects.ts), which reuses the existing can_view_project()
 * Postgres function (already the correct, project-scoped predicate used by
 * every *_select RLS policy for these tables) via RPC, run as the caller.
 *
 * This suite calls the REAL, unmodified Server Actions with real per-role
 * authenticated clients against the real local Postgres instance.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD04Fixtures, getAdmin, clientForToken, type D04Fixtures, type TestUser } from '../setup/fixtures-d04'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { addProjectMember, removeProjectMember, createMilestone, updateMilestone } from '@/lib/actions/projects'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('D-04: project/milestone object-level authorization', () => {
  let fx: D04Fixtures

  beforeAll(async () => {
    fx = await setupD04Fixtures()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  describe('unrelated agent — denied on every mutation', () => {
    it('cannot add a member to a project they have no connection to', async () => {
      actAs(fx.unrelatedAgent)
      const result = await addProjectMember(fx.projectId, fx.unrelatedAgent.id)
      expect(result.error).toBeTruthy()

      const admin = getAdmin()
      const { data } = await admin.from('project_members').select('user_id').eq('project_id', fx.projectId).eq('user_id', fx.unrelatedAgent.id).maybeSingle()
      expect(data).toBeNull()
    })

    it('cannot remove a legitimate member from a project they have no connection to', async () => {
      actAs(fx.unrelatedAgent)
      const result = await removeProjectMember(fx.projectId, fx.projectMember.id)
      expect(result.error).toBeTruthy()

      const admin = getAdmin()
      const { data } = await admin.from('project_members').select('user_id').eq('project_id', fx.projectId).eq('user_id', fx.projectMember.id).maybeSingle()
      expect(data).not.toBeNull()
    })

    it('cannot create a milestone on a project they have no connection to', async () => {
      actAs(fx.unrelatedAgent)
      const result = await createMilestone({
        projectId: fx.projectId,
        name: 'Unauthorized milestone',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      })
      expect(result.error).toBeTruthy()
      expect(result.data).toBeUndefined()
    })

    it('cannot update a milestone on a project they have no connection to', async () => {
      actAs(fx.unrelatedAgent)
      const result = await updateMilestone(fx.milestoneId, { name: 'Tampered name' })
      expect(result.error).toBeTruthy()

      const admin = getAdmin()
      const { data } = await admin.from('milestones').select('name').eq('id', fx.milestoneId).single()
      expect(data?.name).not.toBe('Tampered name')
    })
  })

  describe('project member/owner — intended operations succeed', () => {
    it('project member can create a milestone on their own project', async () => {
      actAs(fx.projectMember)
      const result = await createMilestone({
        projectId: fx.projectId,
        name: 'Member-created milestone',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      })
      expect(result.error).toBeUndefined()
      expect(result.data?.id).toBeTruthy()
    })

    it('project owner can add a member to their own project', async () => {
      actAs(fx.projectOwner)
      const result = await addProjectMember(fx.projectId, fx.unrelatedAgent.id)
      expect(result.error).toBeUndefined()

      const admin = getAdmin()
      const { data } = await admin.from('project_members').select('user_id').eq('project_id', fx.projectId).eq('user_id', fx.unrelatedAgent.id).maybeSingle()
      expect(data).not.toBeNull()
    })
  })

  describe('manager/admin — broader role scope still works', () => {
    it('manager can create a milestone on a project they are not otherwise connected to', async () => {
      actAs(fx.manager)
      const result = await createMilestone({
        projectId: fx.projectId,
        name: 'Manager-created milestone',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      })
      expect(result.error).toBeUndefined()
      expect(result.data?.id).toBeTruthy()
    })

    it('admin can update a milestone on a project they are not otherwise connected to', async () => {
      actAs(fx.admin)
      const result = await updateMilestone(fx.milestoneId, { name: 'Admin-updated name' })
      expect(result.error).toBeUndefined()

      const admin = getAdmin()
      const { data } = await admin.from('milestones').select('name').eq('id', fx.milestoneId).single()
      expect(data?.name).toBe('Admin-updated name')
    })
  })
})
