// D-009: who may change whom (set a password, change a role, deactivate).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { targetGuardError } from '@/lib/admin/target-guard'

const owner = { id: 'o', role: 'platform_owner' }
const admin = { id: 'a', role: 'admin' }
const admin2 = { id: 'a2', role: 'admin' }
const manager = { id: 'm', role: 'manager' }
const user = { id: 'u', role: 'user' }

describe('targetGuardError', () => {
  it('a plain admin cannot change a platform owner or another admin (the original gap)', () => {
    for (const action of ['role', 'active', 'password'] as const) {
      expect(targetGuardError(admin, owner, action), `owner/${action}`).toMatch(/platform owner/)
      expect(targetGuardError(admin, admin2, action), `admin/${action}`).toMatch(/platform owner/)
    }
  })
  it('a platform owner can change admins and ordinary users', () => {
    for (const action of ['role', 'active', 'password'] as const) {
      expect(targetGuardError(owner, admin, action)).toBeNull()
      expect(targetGuardError(owner, user, action)).toBeNull()
    }
  })
  it('an admin can still manage ordinary users, technicians and managers', () => {
    for (const t of [user, manager, { id: 'x', role: 'agent' }]) for (const action of ['role', 'active', 'password'] as const) expect(targetGuardError(admin, t, action)).toBeNull()
  })
  it('nobody changes their own role or deactivates themselves, but may set their own password', () => {
    expect(targetGuardError(owner, owner, 'role')).toMatch(/own role/)
    expect(targetGuardError(admin, admin, 'active')).toMatch(/own account/)
    expect(targetGuardError(admin, admin, 'password')).toBeNull()
    expect(targetGuardError(owner, owner, 'password')).toBeNull()
  })
})

// ── the three actions use it ────────────────────────────────────────────────────────────────────────────────────────────────────
const updates: { table: string; values: unknown }[] = []
const authCalls: unknown[] = []
let currentProfile: { id: string; role: string; org_id: string } | null = null
let targetRow: { id: string; role: string; org_id: string } | null = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => currentProfile }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        update: (values: unknown) => { updates.push({ table, values }); return q },
        eq: () => q,
        maybeSingle: async () => ({ data: targetRow }),
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      }
      return q
    },
    auth: { admin: { updateUserById: async (...a: unknown[]) => { authCalls.push(a); return { error: null } } } },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ limited: false, remaining: 9 }) }))
vi.mock('@/lib/actions/admin/audit', () => ({ logAdminAudit: vi.fn() }))

const ORG = '00000000-0000-0000-0000-000000000001'

describe('the admin actions refuse to touch a platform owner as a plain admin', () => {
  beforeEach(() => { updates.length = 0; authCalls.length = 0; currentProfile = { id: 'a', role: 'admin', org_id: ORG }; targetRow = { id: 'o', role: 'platform_owner', org_id: ORG } })

  it('adminSetPassword', async () => {
    const { adminSetPassword } = await import('@/lib/actions/admin/users')
    const r = await adminSetPassword('o', 'a-new-password-1')
    expect(r.error).toMatch(/platform owner/)
    expect(authCalls).toEqual([])
  })
  it('updateUserRole', async () => {
    const { updateUserRole } = await import('@/lib/actions/admin/users')
    const r = await updateUserRole('o', 'user')
    expect(r.error).toMatch(/platform owner/)
    expect(updates).toEqual([])
  })
  it('toggleUserActive', async () => {
    const { toggleUserActive } = await import('@/lib/actions/admin/users')
    const r = await toggleUserActive('o', false)
    expect(r.error).toMatch(/platform owner/)
    expect(updates).toEqual([])
    expect(authCalls).toEqual([])
  })

  it('the same actions still work for an ordinary target', async () => {
    targetRow = { id: 'u', role: 'user', org_id: ORG }
    const { adminSetPassword, updateUserRole, toggleUserActive } = await import('@/lib/actions/admin/users')
    expect((await adminSetPassword('u', 'a-new-password-1')).error).toBeUndefined()
    expect((await updateUserRole('u', 'agent')).error).toBeUndefined()
    expect((await toggleUserActive('u', false)).error).toBeUndefined()
  })

  it('deactivating a user also blocks their sign-in at the authentication service, and reactivating lifts it (D-010)', async () => {
    targetRow = { id: 'u', role: 'user', org_id: ORG }
    const { toggleUserActive } = await import('@/lib/actions/admin/users')
    await toggleUserActive('u', false)
    await toggleUserActive('u', true)
    expect(authCalls).toEqual([['u', { ban_duration: '876000h' }], ['u', { ban_duration: 'none' }]])
  })
})
