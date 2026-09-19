import { describe, it, expect, vi, beforeEach } from 'vitest'

// Main is served over plain HTTP, where crypto.randomUUID does not exist. The browser
// event queue must still send events there (this silently dropped everything once).
describe('event client on a non-secure (HTTP) page', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  it('still sends a batch when crypto.randomUUID is missing', async () => {
    const sent: string[] = []
    const store = new Map<string, string>()
    vi.stubGlobal('window', { addEventListener: vi.fn() })
    vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' })
    vi.stubGlobal('crypto', {}) // no randomUUID
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    vi.stubGlobal('navigator', {
      sendBeacon: (_url: string, blob: Blob) => { void blob.text().then((t) => sent.push(t)); return true },
    })

    const { queueEvent, flushEvents } = await import('@/lib/events/client')
    queueEvent({ kind: 'click', path: '/home', target: 'button:Save' })
    flushEvents()
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 20))

    expect(sent).toHaveLength(1)
    const body = JSON.parse(sent[0])
    expect(body.sessionId).toMatch(/\S{8,}/)
    expect(body.events[0]).toMatchObject({ kind: 'click', target: 'button:Save' })
  })
})
