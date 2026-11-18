import { describe, expect, it, vi } from 'vitest'
import { fetchAllPages, fetchAllPagesParallel, PagingError, type CountedPageResult } from '@/lib/queries/paging'

/** A fake table of `n` rows (numbers 0..n-1) that answers like the data service: pages by range, the total only when asked. */
function table(n: number, opts: { omitCount?: boolean; failAt?: number } = {}) {
  const calls: { from: number; to: number; withCount: boolean }[] = []
  const build = vi.fn(async (from: number, to: number, withCount: boolean): Promise<CountedPageResult> => {
    calls.push({ from, to, withCount })
    if (opts.failAt === from) return { data: null, error: { message: 'boom' } }
    const rows = Array.from({ length: Math.max(0, Math.min(to + 1, n) - from) }, (_, i) => from + i)
    return { data: rows, error: null, ...(withCount && !opts.omitCount ? { count: n } : {}) }
  })
  return { build, calls }
}

describe('fetchAllPagesParallel', () => {
  it('returns the same rows, in the same order, as reading page by page', async () => {
    const t = table(4321)
    const par = await fetchAllPagesParallel<number>(t.build)
    const seq = await fetchAllPages<number>((from, to) => table(4321).build(from, to, false))
    expect(par.rows).toEqual(seq.rows)
    expect(par.rows).toHaveLength(4321)
    expect(par.truncated).toBe(false)
  })

  it('asks for the total only on the first page', async () => {
    const t = table(3500)
    await fetchAllPagesParallel<number>(t.build)
    expect(t.calls.filter((c) => c.withCount)).toEqual([{ from: 0, to: 999, withCount: true }])
  })

  it('reads the later pages a few at a time (never more than the limit at once)', async () => {
    let running = 0, peak = 0
    const build = async (from: number, to: number, withCount: boolean): Promise<CountedPageResult> => {
      running++; peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      const rows = Array.from({ length: Math.max(0, Math.min(to + 1, 9500) - from) }, (_, i) => from + i)
      return { data: rows, error: null, ...(withCount ? { count: 9500 } : {}) }
    }
    const out = await fetchAllPagesParallel<number>(build, { concurrency: 3 })
    expect(out.rows).toHaveLength(9500)
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('stops at the cap and says the result is cut short', async () => {
    const t = table(30_000)
    const out = await fetchAllPagesParallel<number>(t.build, { maxRows: 20_001 })
    expect(out.rows.length).toBeGreaterThanOrEqual(20_001)
    expect(out.rows.length).toBeLessThan(30_000)
    expect(out.truncated).toBe(true)
  })

  it('a result smaller than one page is one call', async () => {
    const t = table(40)
    const out = await fetchAllPagesParallel<number>(t.build)
    expect(out.rows).toHaveLength(40)
    expect(t.build).toHaveBeenCalledTimes(1)
  })

  it('an error on any page throws (never a quietly smaller result)', async () => {
    await expect(fetchAllPagesParallel<number>(table(5000, { failAt: 2000 }).build)).rejects.toBeInstanceOf(PagingError)
    await expect(fetchAllPagesParallel<number>(table(5000, { failAt: 0 }).build)).rejects.toBeInstanceOf(PagingError)
  })

  it('without a total from the database it reads on page by page like fetchAllPages', async () => {
    const t = table(2500, { omitCount: true })
    const out = await fetchAllPagesParallel<number>(t.build)
    expect(out.rows).toHaveLength(2500)
    expect(out.rows[2499]).toBe(2499)
  })
})
