import { describe, it, expect, vi } from 'vitest'
import { inBatches, inBatchesDo } from '@/lib/queries/in-batches'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

describe('queries over long id lists (D-047)', () => {
  it('splits into batches, joins the rows, and never sends an oversized list', async () => {
    const seen: number[] = []
    const run = vi.fn(async (batch: string[]) => { seen.push(batch.length); return { data: batch.map((id) => ({ id })), error: null } })
    const { data, error } = await inBatches<{ id: string }>(ids(250), run)
    expect(error).toBeNull()
    expect(data).toHaveLength(250)
    expect(seen).toEqual([100, 100, 50])
  })
  it('removes repeated ids and sends nothing for an empty list', async () => {
    const run = vi.fn(async (b: string[]) => ({ data: b.map((id) => ({ id })), error: null }))
    expect((await inBatches(['a', 'b', 'a', 'b'], run)).data).toHaveLength(2)
    expect((await inBatches([], run)).data).toEqual([])
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('reports an error from any batch but keeps the rows of the others', async () => {
    let call = 0
    const run = async (b: string[]) => (++call === 2 ? { data: null, error: { message: 'boom' } } : { data: b.map((id) => ({ id })), error: null })
    const { data, error } = await inBatches(ids(250), run)
    expect(error).toEqual({ message: 'boom' })
    expect(data).toHaveLength(150)
  })
  it('a write is sent batch by batch and stops at the first error', async () => {
    const sizes: number[] = []
    const ok = await inBatchesDo(ids(230), async (b) => { sizes.push(b.length); return { error: null } })
    expect(ok.error).toBeNull(); expect(sizes).toEqual([100, 100, 30])
    let n = 0
    const failed = await inBatchesDo(ids(230), async () => (++n === 2 ? { error: { message: 'no' } } : { error: null }))
    expect(failed.error).toEqual({ message: 'no' }); expect(n).toBe(2)
  })
})
