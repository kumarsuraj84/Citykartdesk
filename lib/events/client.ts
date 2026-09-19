'use client'

// Browser-side event queue: batches events and sends them to /api/events every few
// seconds, and immediately when the tab is hidden/closed. Failures are ignored —
// event logging must never affect the user.
export interface ClientEvent {
  kind: 'pageview' | 'click' | 'js_error' | 'render_error'
  path?: string
  target?: string
  message?: string
  detail?: unknown
}

const FLUSH_MS = 5000
const MAX_QUEUE = 100
const queue: (ClientEvent & { at: number })[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let sessionId: string | null = null
let hooked = false

function getSessionId(): string {
  if (sessionId) return sessionId
  try {
    sessionId = sessionStorage.getItem('ck_evt_sid')
    if (!sessionId) {
      sessionId = crypto.randomUUID()
      sessionStorage.setItem('ck_evt_sid', sessionId)
    }
  } catch {
    sessionId = crypto.randomUUID()
  }
  return sessionId
}

export function flushEvents(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (queue.length === 0) return
  const events = queue.splice(0, 50)
  const body = JSON.stringify({ sessionId: getSessionId(), events })
  try {
    if (navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) {
      if (queue.length) timer = setTimeout(flushEvents, 500)
      return
    }
    void fetch('/api/events', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {})
  } catch { /* ignore */ }
  if (queue.length) timer = setTimeout(flushEvents, 500)
}

export function queueEvent(e: ClientEvent): void {
  if (typeof window === 'undefined') return
  if (!hooked) {
    hooked = true
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushEvents() })
    window.addEventListener('pagehide', flushEvents)
  }
  if (queue.length >= MAX_QUEUE) queue.shift()
  queue.push({ ...e, at: Date.now() })
  if (!timer) timer = setTimeout(flushEvents, FLUSH_MS)
}
