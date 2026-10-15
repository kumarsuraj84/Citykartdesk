// VAPT VA-DB-11 / VA-TKT-13: a burst of parallel wrong guesses must not get more than the allowed number of tries.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/approvals/email-link', () => ({
  CODE_MAX_ATTEMPTS: 5, CODE_MINUTES: 10,
  newApprovalCode: () => '123456',
  normaliseCode: (c: string) => (/^\d{6}$/.test(c) ? c : null),
  hashApprovalCode: (_a: string, _b: string, code: string) => `h:${code}`,
  codesEqual: (a: string, b: string) => a === b,
}))
import { consumeApprovalCode } from '@/lib/approvals/email-code'

/** A tiny in-memory stand-in for the one table, with the same compare-and-set behaviour as the database and a pause between steps so calls interleave. */
function fakeAdmin() {
  const row = { id: 'r1', approval_id: 'a', approver_id: 'p', code_hash: 'h:123456', attempts: 0, used_at: null as string | null, expires_at: new Date(Date.now() + 600_000).toISOString(), created_at: 'x' }
  const tick = () => new Promise((r) => setTimeout(r, 1))
  const select = () => {
    const q: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      eq: () => q, is: () => q, gt: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => { await tick(); return { data: row.used_at ? null : { id: row.id, code_hash: row.code_hash, attempts: row.attempts } } },
    }
    return q
  }
  const update = (patch: Partial<typeof row>) => {
    const conds: Array<[string, unknown]> = []
    const q: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      eq: (k: string, v: unknown) => { conds.push([k, v]); return q },
      is: () => q,
      select: () => q,
      maybeSingle: async () => { await tick(); const ok = conds.every(([k, v]) => (row as Record<string, unknown>)[k] === v); if (ok) Object.assign(row, patch); return { data: ok ? { id: row.id, attempts: row.attempts } : null } },
    }
    return q
  }
  return { row, from: () => ({ select, update }) }
}

describe('approval code: parallel wrong guesses', () => {
  it('20 simultaneous wrong guesses count as at most 5 tries and the code ends up locked', async () => {
    const admin = fakeAdmin()
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => consumeApprovalCode(admin, 'a', 'p', String(100000 + i))))
    expect(results.filter((r) => r === 'wrong').length).toBeLessThanOrEqual(4)     // the 5th wrong try already says 'locked'
    expect(results.every((r) => r === 'wrong' || r === 'locked')).toBe(true)
    expect(admin.row.attempts).toBeLessThanOrEqual(5)
    expect(await consumeApprovalCode(admin, 'a', 'p', '123456')).toBe('locked')     // even the right code is refused once locked
  })
  it('the right code still works on the first try', async () => {
    const admin = fakeAdmin()
    expect(await consumeApprovalCode(admin, 'a', 'p', '123456')).toBe('ok')
  })
})
