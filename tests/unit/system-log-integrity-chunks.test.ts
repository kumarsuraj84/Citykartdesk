// QA-D019: the System Log "integrity check" asked the database to verify at most 500,000 chained rows from the start, then said "ok, N rows verified" with N = ALL
// chained rows. Once the log grew past 500,000 rows the newest rows were never checked and a tampered new row was reported as intact. The check must walk the whole chain.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { from: number; limit: number }[] = []
let headSeq = 0
let brokenAt: { fromSeqAtLeast: number; id: number } | null = null
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => ({ id: 'a1', role: 'admin', org_id: 'o1' }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (_fn: string, a: { p_from_seq: number; p_limit: number }) => {
      calls.push({ from: a.p_from_seq, limit: a.p_limit })
      const covers = brokenAt && a.p_from_seq <= brokenAt.fromSeqAtLeast && brokenAt.fromSeqAtLeast < a.p_from_seq + a.p_limit
      return { data: covers ? [{ broken_id: brokenAt!.id, reason: 'the record content does not match its hash' }] : [], error: null }
    },
    from: (t: string) => ({
      select: (_c: string, o?: { head?: boolean }) => {
        const q: Record<string, unknown> = {
          not: () => Promise.resolve({ count: headSeq }),
          maybeSingle: async () => ({ data: { seq: headSeq } }),
          single: async () => ({ data: { seq: headSeq } }),
          then: undefined,
        }
        return t === 'system_log_chain_head' ? q : { not: () => Promise.resolve({ count: headSeq }) }
      },
    }),
  }),
}))

beforeEach(() => { calls.length = 0; headSeq = 0; brokenAt = null })

describe('System Log integrity check walks the whole chain', () => {
  it('a log of 1,250,000 chained rows is covered from the first row to the last, with no gap between the pieces', async () => {
    headSeq = 1_250_000
    const { verifyLogIntegrity } = await import('@/lib/actions/admin/system-log')
    const r = await verifyLogIntegrity()
    expect(r.ok).toBe(true)
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[0].from).toBe(0)
    for (let i = 1; i < calls.length; i++) expect(calls[i].from).toBeLessThanOrEqual(calls[i - 1].from + calls[i - 1].limit - 1)   // the next piece starts on the last row of the one before
    const last = calls[calls.length - 1]
    expect(last.from + last.limit).toBeGreaterThan(headSeq)
    expect(Math.max(...calls.map((c) => c.limit))).toBeLessThanOrEqual(500_000)
  })

  it('a record changed beyond the first 500,000 rows is found', async () => {
    headSeq = 700_000
    brokenAt = { fromSeqAtLeast: 650_000, id: 998630 }
    const { verifyLogIntegrity } = await import('@/lib/actions/admin/system-log')
    const r = await verifyLogIntegrity()
    expect(r).toMatchObject({ ok: false, brokenId: 998630 })
  })

  it('a small log is still checked in one call', async () => {
    headSeq = 4_000
    const { verifyLogIntegrity } = await import('@/lib/actions/admin/system-log')
    expect((await verifyLogIntegrity()).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
