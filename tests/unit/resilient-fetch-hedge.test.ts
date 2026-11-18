import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HEDGE_AFTER_MS, canHedge, resetBreakers, resilientFetch } from '@/lib/supabase/resilient-fetch'
import { SLOW_CALL_MS, resetCallStats, takeCallStats } from '@/lib/supabase/call-stats'

// Stuck-call protection: a read with no answer after HEDGE_AFTER_MS is sent a second time and the first answer wins (the 18 Nov 2026 stall: pages waited the full 20 s).
const REST = 'http://api.test/rest/v1/requests?select=id'
const fetchMock = vi.fn()

const abortError = () => new DOMException('aborted', 'AbortError')
/** a copy of the call that never answers; it ends only when it is cancelled */
const hangs = (init?: RequestInit) => new Promise<Response>((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(abortError())) })

describe('resilient fetch: a stuck read is sent a second time', () => {
  beforeEach(() => { vi.useFakeTimers(); resetBreakers(); resetCallStats(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('only reads are ever sent twice', () => {
    expect(canHedge('GET')).toBe(true)
    expect(canHedge('head')).toBe(true)
    expect(canHedge(undefined)).toBe(true)
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(canHedge(m), m).toBe(false)
  })

  it('a normal read is sent once and leaves no timer behind', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }))
    expect((await resilientFetch(REST)).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    const s = takeCallStats()
    expect(s).toMatchObject({ calls: 1, slow: 0, hedged: 0, hedgeWon: 0, timeouts: 0 })
  })

  it('when the first copy hangs, the second answers and the person waits 3 seconds, not 20', async () => {
    const signals: (AbortSignal | undefined)[] = []
    fetchMock.mockImplementationOnce((_u: unknown, init?: RequestInit) => { signals.push(init?.signal ?? undefined); return hangs(init) })
    fetchMock.mockImplementationOnce((_u: unknown, init?: RequestInit) => { signals.push(init?.signal ?? undefined); return Promise.resolve(new Response('[{"id":1}]', { status: 200 })) })
    const started = Date.now()
    const p = resilientFetch(REST)
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS)
    const res = await p
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 1 }])
    expect(Date.now() - started).toBe(HEDGE_AFTER_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)     // the stuck copy was cancelled
    expect(signals[1]?.aborted).toBe(false)    // the one that answered was left alone
    expect(vi.getTimerCount()).toBe(0)
    expect(takeCallStats()).toMatchObject({ calls: 1, hedged: 1, hedgeWon: 1, timeouts: 0, slow: 1 })
  })

  it('when the first copy answers after the second was sent, the first is used and the second is cancelled', async () => {
    let answerFirst: (r: Response) => void = () => {}
    const signals: (AbortSignal | undefined)[] = []
    fetchMock.mockImplementationOnce((_u: unknown, init?: RequestInit) => { signals.push(init?.signal ?? undefined); return new Promise<Response>((res) => { answerFirst = res }) })
    fetchMock.mockImplementationOnce((_u: unknown, init?: RequestInit) => { signals.push(init?.signal ?? undefined); return hangs(init) })
    const p = resilientFetch(REST)
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    answerFirst(new Response('[]', { status: 200 }))
    expect((await p).status).toBe(200)
    expect(signals[1]?.aborted).toBe(true)
    expect(takeCallStats()).toMatchObject({ hedged: 1, hedgeWon: 0 })
  })

  it('a write that hangs is never sent a second time', async () => {
    fetchMock.mockImplementation((_u: unknown, init?: RequestInit) => hangs(init))
    const p = resilientFetch(REST, { method: 'POST', body: '{}' }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS * 3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await p).toBeInstanceOf(DOMException)
  })

  it('when both copies hang, the one time limit still applies (20 s) and it counts as a timeout', async () => {
    fetchMock.mockImplementation((_u: unknown, init?: RequestInit) => hangs(init))
    const p = resilientFetch(REST).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await p).toBeInstanceOf(DOMException)
    expect(fetchMock).toHaveBeenCalledTimes(2)   // not 3 attempts: a timeout is never repeated
    expect(takeCallStats()).toMatchObject({ calls: 1, timeouts: 1 })
  })

  it('if the first copy fails after the second was sent, the second still gets its chance', async () => {
    let failFirst: (e: unknown) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise<Response>((_res, rej) => { failFirst = rej }))
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => setTimeout(() => res(new Response('[]', { status: 200 })), 500)))
    const p = resilientFetch(REST)
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS)
    failFirst(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
    await vi.advanceTimersByTimeAsync(500)
    expect((await p).status).toBe(200)
  })

  it('a service that is only slow is not buried: at most 8 second copies at a time', async () => {
    fetchMock.mockImplementation((_u: unknown, init?: RequestInit) => hangs(init))
    const calls = Array.from({ length: 10 }, () => resilientFetch(REST).catch((e) => e))
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS)
    expect(fetchMock).toHaveBeenCalledTimes(10 + 8)
    await vi.advanceTimersByTimeAsync(20_000)
    await Promise.all(calls)
  })

  it('a call that is slow but answers in the end is counted as slow', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>((res) => setTimeout(() => res(new Response('[]', { status: 200 })), SLOW_CALL_MS + 200)))
    const p = resilientFetch('http://api.test/auth/v1/user', { method: 'POST', body: '{}' })   // a write: not sent twice, only counted
    await vi.advanceTimersByTimeAsync(SLOW_CALL_MS + 200)
    await p
    expect(takeCallStats()).toMatchObject({ calls: 1, slow: 1, hedged: 0 })
  })
})
