// getPollIdentity: who is asking the pop-up check. Three small reads remembered for 30 s, with the same refusals as the full profile (deactivated, still waiting for a first password).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = vi.hoisted(() => ({ row: null as unknown, error: null as unknown, reads: 0, verified: 'u1' as string | null | undefined }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }))
vi.mock('@/lib/auth/verified-user', () => ({ readVerifiedUserId: vi.fn(() => state.verified) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/queries/approvals', () => ({ getActionableApprovalsForUser: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { state.reads++; return { data: state.row, error: state.error } } }) }) }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}))

import { getPollIdentity } from '@/lib/queries/profiles'

// the 30 s memory lives in the module, so every test is a different person
let n = 0
let me = 'u0'
beforeEach(() => {
  vi.useFakeTimers()
  process.env.SHORT_CACHE_IN_TESTS = '1'      // the cache itself is under test here
  me = `u${++n}`
  state.row = { id: me, is_active: true, must_reset_password: false }; state.error = null; state.reads = 0; state.verified = me
})
afterEach(() => { vi.useRealTimers(); delete process.env.SHORT_CACHE_IN_TESTS })

describe('getPollIdentity', () => {
  it('answers with the id and asks the database once for 30 s', async () => {
    expect(await getPollIdentity()).toEqual({ id: me })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await getPollIdentity()).toEqual({ id: me })
    expect(state.reads).toBe(1)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(await getPollIdentity()).toEqual({ id: me })
    expect(state.reads).toBe(2)
  })

  it('refuses a deactivated person and one who must still choose a password, and never keeps the refusal', async () => {
    state.row = { id: me, is_active: false, must_reset_password: false }
    expect(await getPollIdentity()).toBeNull()
    state.row = { id: me, is_active: true, must_reset_password: true }
    expect(await getPollIdentity()).toBeNull()
    state.row = { id: me, is_active: true, must_reset_password: false }   // reactivated / password chosen: let in at once
    expect(await getPollIdentity()).toEqual({ id: me })
    expect(state.reads).toBe(3)
  })

  it('refuses when there is no profile row, and when the proxy says nobody is signed in (no database read at all)', async () => {
    state.row = null
    expect(await getPollIdentity()).toBeNull()
    state.verified = null
    const before = state.reads
    expect(await getPollIdentity()).toBeNull()
    expect(state.reads).toBe(before)
  })

  it('a database error is thrown (the route answers 503) and not remembered', async () => {
    state.error = { message: 'boom' }
    await expect(getPollIdentity()).rejects.toThrow()
    state.error = null
    expect(await getPollIdentity()).toEqual({ id: me })
  })

  it('two different people never share an answer', async () => {
    expect(await getPollIdentity()).toEqual({ id: me })
    const other = `${me}-other`
    state.verified = other; state.row = { id: other, is_active: true, must_reset_password: false }
    expect(await getPollIdentity()).toEqual({ id: other })
    expect(state.reads).toBe(2)
  })
})
