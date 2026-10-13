// D-019: reading every page of a query must never hide an error or a cut-off.

import { describe, it, expect } from 'vitest'
import { fetchAllPages, PagingError } from '@/lib/queries/paging'

const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }))
const source = (rows: { id: number }[], failAtOffset?: number) => async (from: number, to: number) => {
  if (failAtOffset !== undefined && from >= failAtOffset) return { data: null, error: { message: 'canceling statement due to statement timeout' } }
  return { data: rows.slice(from, to + 1), error: null }
}

describe('fetchAllPages', () => {
  it('reads every page of a bigger-than-one-page result', async () => {
    const r = await fetchAllPages<{ id: number }>(source(table(2350)))
    expect(r.rows).toHaveLength(2350)
    expect(r.truncated).toBe(false)
    expect(r.rows[2349].id).toBe(2349)
  })
  it('an exact multiple of the page size ends correctly (no endless loop, nothing lost)', async () => {
    const r = await fetchAllPages<{ id: number }>(source(table(2000)))
    expect(r.rows).toHaveLength(2000)
  })
  it('an error on a later page THROWS instead of returning the rows read so far (the original bug)', async () => {
    await expect(fetchAllPages(source(table(5000), 2000))).rejects.toBeInstanceOf(PagingError)
    await expect(fetchAllPages(source(table(5000), 2000))).rejects.toThrow(/statement timeout.*from 2000/)
  })
  it('an error on the first page throws too', async () => {
    await expect(fetchAllPages(source(table(10), 0))).rejects.toThrow(PagingError)
  })
  it('reaching the row cap is reported, not hidden', async () => {
    const r = await fetchAllPages<{ id: number }>(source(table(5000)), { maxRows: 3000 })
    expect(r.truncated).toBe(true)
    expect(r.rows.length).toBeGreaterThanOrEqual(3000)
    expect(r.rows.length).toBeLessThan(5000)
  })
  it('a result that fits under the cap is not marked truncated', async () => {
    expect((await fetchAllPages(source(table(2500)), { maxRows: 3000 })).truncated).toBe(false)
  })
  it('an empty result is fine', async () => {
    expect(await fetchAllPages(source([]))).toEqual({ rows: [], truncated: false })
  })
})
