import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BREAKER_MS, PROBE_TIMEOUT_MS, canRetry, resetBreakers, resilientFetch } from '@/lib/supabase/resilient-fetch'

const withCode = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
const timeout = () => new DOMException('aborted', 'AbortError')

describe('resilient fetch: which failed requests are sent again (audit D-043, REL-1)', () => {
  it('reads are repeated after a fast connection failure, never after a timeout', () => {
    for (const m of ['GET', 'HEAD', undefined]) {
      expect(canRetry(m, withCode('ECONNRESET'))).toBe(true)
      expect(canRetry(m, withCode('ECONNREFUSED'))).toBe(true)
      expect(canRetry(m, timeout())).toBe(false)               // 20 s without an answer: asking again only doubles the wait
      expect(canRetry(m, withCode('ETIMEDOUT'))).toBe(false)
    }
  })
  it('writes are repeated only when the server provably never received them', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(canRetry(m, withCode('ECONNREFUSED')), m).toBe(true)
      expect(canRetry(m, withCode('EADDRINUSE')), m).toBe(true)
      expect(canRetry(m, timeout()), m).toBe(false) // may have been applied
      expect(canRetry(m, withCode('ECONNRESET')), m).toBe(false)
    }
  })
  it('an error the server actually sent is never repeated', () => {
    expect(canRetry('GET', new Error('boom'))).toBe(false)
  })
})

describe('resilient fetch: the fast-fail breaker (REL-1)', () => {
  const REST = 'http://api.test/rest/v1/requests?select=id'
  const AUTH = 'http://api.test/auth/v1/user'
  const fetchMock = vi.fn()

  beforeEach(() => { vi.useFakeTimers(); resetBreakers(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  /** a service that accepts the connection and never answers: only our own time limit ends the call */
  const hang = () => fetchMock.mockImplementation((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))) }))

  it('a call that times out is NOT repeated, and the next calls fail at once instead of each waiting 20 seconds', async () => {
    hang()
    const first = resilientFetch(REST).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await first).toBeInstanceOf(DOMException)
    expect(fetchMock).toHaveBeenCalledTimes(1)               // before: 3 attempts = 60 s

    const started = Date.now()
    for (let i = 0; i < 5; i++) await expect(resilientFetch(REST)).rejects.toMatchObject({ cause: { code: 'ECIRCUITOPEN' } })
    expect(Date.now() - started).toBe(0)                      // no waiting at all
    expect(fetchMock).toHaveBeenCalledTimes(1)               // and nothing was sent
  })

  it('only the failed service is held back; the others keep working', async () => {
    hang()
    const first = resilientFetch(REST).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    await first
    fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    expect((await resilientFetch(AUTH)).status).toBe(200)
  })

  it('tries the service again once the hold-off is over, and a good answer clears it', async () => {
    hang()
    const first = resilientFetch(REST).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    await first
    await vi.advanceTimersByTimeAsync(BREAKER_MS + 1)
    fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response('[]', { status: 200 }))
    expect((await resilientFetch(REST)).status).toBe(200)
    expect((await resilientFetch(REST)).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('while the service stays down only ONE short test call is made after each hold-off, the hold-off doubles, and everyone else still fails at once', async () => {
    hang()
    const first = resilientFetch(REST).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    await first                                                   // t = 20 s, held off for BREAKER_MS
    await vi.advanceTimersByTimeAsync(BREAKER_MS + 1)
    const probe = resilientFetch(REST).catch((e) => e)            // the test call
    await expect(resilientFetch(REST)).rejects.toMatchObject({ cause: { code: 'ECIRCUITOPEN' } })   // others do not pile on
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)           // the test call gives up quickly, not after 20 s
    expect(await probe).toBeInstanceOf(DOMException)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(BREAKER_MS + 1)             // the second hold-off is longer than the first
    await expect(resilientFetch(REST)).rejects.toMatchObject({ cause: { code: 'ECIRCUITOPEN' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(BREAKER_MS + 1)
    const probe2 = resilientFetch(REST).catch((e) => e)
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)
    await probe2
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('a refused connection is repeated quickly (reads), then held off; a one-off reset on a write does not hold anything off', async () => {
    fetchMock.mockRejectedValue(withCode('ECONNREFUSED'))
    const p = resilientFetch(REST).catch((e) => e)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await p).toBeInstanceOf(TypeError)
    expect(fetchMock).toHaveBeenCalledTimes(3)                // the original plus two quick retries
    await expect(resilientFetch(REST)).rejects.toMatchObject({ cause: { code: 'ECIRCUITOPEN' } })

    resetBreakers(); fetchMock.mockReset()
    fetchMock.mockRejectedValueOnce(withCode('ECONNRESET'))
    await expect(resilientFetch(REST, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(TypeError)
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }))
    expect((await resilientFetch(REST, { method: 'POST', body: '{}' })).status).toBe(201)
  })

  it('a server error answer (5xx) is a normal answer: it is returned and does not hold anything off', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"boom"}', { status: 500 }))
    expect((await resilientFetch(REST)).status).toBe(500)
    expect((await resilientFetch(REST)).status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
