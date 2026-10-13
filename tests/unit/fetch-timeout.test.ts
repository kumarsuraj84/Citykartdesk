import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithTimeout } from '@/lib/http/fetch-timeout'

afterEach(() => vi.restoreAllMocks())

describe('fetchWithTimeout (audit D-046)', () => {
  it('cancels a call that never answers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_i, init) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)) }))
    await expect(fetchWithTimeout('https://example.invalid/slow', {}, 30)).rejects.toBeTruthy()
  })
  it('passes the response of a normal call through, with a signal attached', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    const res = await fetchWithTimeout('https://example.invalid/fast', { method: 'POST' })
    expect(await res.text()).toBe('ok')
    expect((spy.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })
  it('still honours the caller\'s own cancel signal', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_i, init) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)) }))
    const own = new AbortController()
    const p = fetchWithTimeout('https://example.invalid/x', { signal: own.signal }, 60_000)
    own.abort(new Error('caller cancelled'))
    await expect(p).rejects.toThrow('caller cancelled')
  })
})
