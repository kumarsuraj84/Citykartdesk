import { describe, expect, it, vi } from 'vitest'
import { AGGREGATES_RPC_MIN_TICKETS, loadRequestAggregates, parseAggregates, type RequestAggregates } from '@/lib/queries/report-aggregates'

const empty = (): RequestAggregates => ({ collabCounts: new Map(), attachmentCounts: new Map(), commentCounts: new Map(), timeMinutes: new Map(), csatRatings: new Map() })
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

describe('parseAggregates', () => {
  it('reads [id, collaborators, attachments, comments, minutes, rating] rows', () => {
    const a = parseAggregates([['t1', 2, 1, 5, 90, 4], ['t2', 0, 0, 0, 0, null]])!
    expect(a.collabCounts.get('t1')).toBe(2)
    expect(a.attachmentCounts.get('t1')).toBe(1)
    expect(a.commentCounts.get('t1')).toBe(5)
    expect(a.timeMinutes.get('t1')).toBe(90)
    expect(a.csatRatings.get('t1')).toBe(4)
    // a ticket with nothing counted is simply absent (callers read `?? 0`), like the per-batch way
    expect(a.collabCounts.has('t2')).toBe(false)
    expect(a.csatRatings.has('t2')).toBe(false)
  })

  it('keeps a rating of 0 out only when it is null (null = no rating given)', () => {
    expect(parseAggregates([['t', 0, 0, 0, 0, 0]])!.csatRatings.get('t')).toBe(0)
  })

  it('gives null for an answer that is not the expected shape', () => {
    expect(parseAggregates(null)).toBeNull()
    expect(parseAggregates({ error: 'x' })).toBeNull()
    expect(parseAggregates([{ id: 1 }])).toBeNull()
    expect(parseAggregates([[1, 2, 3]])).toBeNull()
  })
})

describe('loadRequestAggregates', () => {
  it('uses the database function for a big report (one call, the fallback is not run)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [['id-1', 1, 0, 2, 5, 3]], error: null })
    const fallback = vi.fn(async () => empty())
    const out = await loadRequestAggregates({ rpc }, 'org-1', ids(AGGREGATES_RPC_MIN_TICKETS), fallback)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('report_request_aggregates', { p_org: 'org-1' })
    expect(fallback).not.toHaveBeenCalled()
    expect(out.commentCounts.get('id-1')).toBe(2)
  })

  it('uses the per-batch way for a small report', async () => {
    const rpc = vi.fn()
    const fallback = vi.fn(async () => empty())
    await loadRequestAggregates({ rpc }, 'org-1', ids(AGGREGATES_RPC_MIN_TICKETS - 1), fallback)
    expect(rpc).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('falls back by itself when the function is not in the database yet, or fails, or answers oddly', async () => {
    for (const rpc of [
      vi.fn().mockResolvedValue({ data: null, error: { message: 'Could not find the function public.report_request_aggregates' } }),
      vi.fn().mockRejectedValue(new Error('fetch failed')),
      vi.fn().mockResolvedValue({ data: 'nonsense', error: null }),
    ]) {
      const fallback = vi.fn(async () => empty())
      await loadRequestAggregates({ rpc }, 'org-1', ids(500), fallback)
      expect(fallback).toHaveBeenCalledTimes(1)
    }
  })
})
