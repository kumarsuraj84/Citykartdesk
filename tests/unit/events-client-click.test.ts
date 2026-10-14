import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The browser event queue records which control was clicked just before an error, so the System Log can say "this followed a click".

describe('browser events: errors carry the click that preceded them', () => {
  let sent: { events: { kind: string; detail?: { click?: { target: string; ms: number } | null; lastClickMsAgo?: number | null } }[] }[]

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    sent = []
    const store: Record<string, string> = {}
    vi.stubGlobal('window', { addEventListener: vi.fn() })
    vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' })
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } })
    vi.stubGlobal('navigator', { sendBeacon: (_url: string, blob: Blob & { _text?: string }) => { sent.push(JSON.parse((blob as unknown as { _text: string })._text)); return true } })
    vi.stubGlobal('Blob', class { _text: string; constructor(parts: string[]) { this._text = parts.join('') } })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const flushed = async (mod: typeof import('@/lib/events/client')) => { mod.flushEvents(); return sent.flatMap((b) => b.events) }

  it('an error within three seconds of a click is tagged with that control', async () => {
    const m = await import('@/lib/events/client')
    m.queueEvent({ kind: 'click', path: '/requests', target: 'button:Start Working' })
    vi.advanceTimersByTime(1200)
    m.queueEvent({ kind: 'js_error', path: '/requests', message: 'boom' })
    const events = await flushed(m)
    const err = events.find((e) => e.kind === 'js_error')!
    expect(err.detail!.click).toEqual({ target: 'button:Start Working', ms: 1200 })
  })

  it('an error long after the last click, or with no click at all, is not attributed to one', async () => {
    const m = await import('@/lib/events/client')
    m.queueEvent({ kind: 'js_error', path: '/home', message: 'no click yet' })
    m.queueEvent({ kind: 'click', path: '/home', target: 'a:Home' })
    vi.advanceTimersByTime(10_000)
    m.queueEvent({ kind: 'render_error', path: '/home', message: 'later' })
    const events = (await flushed(m)).filter((e) => e.kind !== 'click')
    expect(events[0].detail!.click).toBeNull()
    expect(events[1].detail!.click).toBeNull()
    expect(events[1].detail!.lastClickMsAgo).toBe(10_000)
  })

  it('keeps the error\'s own details', async () => {
    const m = await import('@/lib/events/client')
    m.queueEvent({ kind: 'js_error', message: 'x', detail: { source: 'a.js', line: 3 } })
    const err = (await flushed(m)).find((e) => e.kind === 'js_error')!
    expect(err.detail).toMatchObject({ source: 'a.js', line: 3 })
  })
})
