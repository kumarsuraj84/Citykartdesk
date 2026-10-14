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

// crypto.randomUUID only exists on HTTPS/localhost pages; Main is served over plain HTTP,
// so fall back to a random string (this is only a grouping label, not a secret).
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

function getSessionId(): string {
  if (sessionId) return sessionId
  try {
    sessionId = sessionStorage.getItem('ck_evt_sid')
    if (!sessionId) {
      sessionId = newId()
      sessionStorage.setItem('ck_evt_sid', sessionId)
    }
  } catch {
    sessionId = newId()
  }
  return sessionId
}

export function flushEvents(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (queue.length === 0) return
  const events = queue.splice(0, 50)

  try {
    const body = JSON.stringify({ sessionId: getSessionId(), events })
    if (navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) {
      if (queue.length) timer = setTimeout(flushEvents, 500)
      return
    }
    void fetch('/api/events', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {})
  } catch { /* ignore */ }
  if (queue.length) timer = setTimeout(flushEvents, 500)
}

// The last control the person clicked, so an error that follows within a few seconds can be recorded as "caused by a click" (and which one).
let lastClick: { target: string; at: number } | null = null
const CLICK_WINDOW_MS = 3000

export function queueEvent(e: ClientEvent): void {
  if (typeof window === 'undefined') return
  if (e.kind === 'click' && e.target) lastClick = { target: e.target, at: Date.now() }
  if (e.kind === 'js_error' || e.kind === 'render_error') {
    const ms = lastClick ? Date.now() - lastClick.at : null
    const click = lastClick && ms !== null && ms <= CLICK_WINDOW_MS ? { target: lastClick.target, ms } : null
    e = { ...e, detail: { ...((e.detail && typeof e.detail === 'object' ? e.detail : {}) as object), click, ...(click ? {} : { lastClickMsAgo: ms }) } }
  }
  if (!hooked) {
    hooked = true
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushEvents() })
    window.addEventListener('pagehide', flushEvents)
  }
  if (queue.length >= MAX_QUEUE) queue.shift()
  queue.push({ ...e, at: Date.now() })
  if (!timer) timer = setTimeout(flushEvents, FLUSH_MS)
}
