import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createShortCache } from '@/lib/cache/short-ttl'

beforeEach(() => { vi.useFakeTimers(); process.env.SHORT_CACHE_IN_TESTS = '1' })
afterEach(() => { vi.useRealTimers(); delete process.env.SHORT_CACHE_IN_TESTS })

describe('short-lived dashboard cache (D-040)', () => {
  it('keeps a value for its time and loads again afterwards', async () => {
    const c = createShortCache<{ n: number }>(60_000)
    let n = 0
    const load = vi.fn(async () => ({ n: ++n }))
    expect((await c.get('k', load)).n).toBe(1)
    expect((await c.get('k', load)).n).toBe(1)
    await vi.advanceTimersByTimeAsync(59_000)
    expect((await c.get('k', load)).n).toBe(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await c.get('k', load)).n).toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('different keys (different organization / scope / level) never share a value', async () => {
    const c = createShortCache<string>(60_000)
    expect(await c.get('org-a|all', async () => 'A rows')).toBe('A rows')
    expect(await c.get('org-b|all', async () => 'B rows')).toBe('B rows')
    expect(await c.get('org-a|team:1', async () => 'A team rows')).toBe('A team rows')
    expect(await c.get('org-a|all', async () => 'never')).toBe('A rows')
  })

  it('identical loads that arrive together share ONE query', async () => {
    const c = createShortCache<number>(60_000)
    let release: (v: number) => void = () => {}
    const load = vi.fn(() => new Promise<number>((r) => { release = r }))
    const all = Promise.all([c.get('k', load), c.get('k', load), c.get('k', load)])
    release(7)
    expect(await all).toEqual([7, 7, 7])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a failed load is not kept: everyone waiting sees the error, the next call tries again', async () => {
    const c = createShortCache<number>(60_000)
    const load = vi.fn().mockRejectedValueOnce(new Error('database down')).mockResolvedValue(5)
    await expect(c.get('k', load)).rejects.toThrow('database down')
    expect(await c.get('k', load)).toBe(5)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('every caller gets its own copy, so changing one result cannot change another', async () => {
    const c = createShortCache<{ rows: number[] }>(60_000)
    const a = await c.get('k', async () => ({ rows: [1, 2, 3] }))
    a.rows.push(99)
    const b = await c.get('k', async () => ({ rows: [] }))
    expect(b.rows).toEqual([1, 2, 3])
  })

  it('fresh skips the stored value (exports), and the new value replaces it', async () => {
    const c = createShortCache<number>(60_000)
    let n = 0
    const load = async () => ++n
    expect(await c.get('k', load)).toBe(1)
    expect(await c.get('k', load, { fresh: true })).toBe(2)
    expect(await c.get('k', load)).toBe(2)
  })

  it('is bounded: the oldest entries are dropped past the limit', async () => {
    const c = createShortCache<number>(60_000, 3)
    for (let i = 0; i < 6; i++) await c.get(`k${i}`, async () => i)
    expect(c.size()).toBeLessThanOrEqual(3)
  })

  it('inside the test suites the stored value is bypassed unless asked for', async () => {
    delete process.env.SHORT_CACHE_IN_TESTS
    const c = createShortCache<number>(60_000)
    let n = 0
    expect(await c.get('k', async () => ++n)).toBe(1)
    expect(await c.get('k', async () => ++n)).toBe(2)
  })
})
