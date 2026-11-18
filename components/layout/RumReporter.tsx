'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Real-user measurement for the Health & Performance page (platform owners read it). Draws nothing.
 *  - 'vitals': once per full page load, when the person leaves or after 15 s: time to first byte, load time, largest paint, layout shift, slowest click.
 *  - 'layout': once per screen visited in this tab (2.5 s after it appeared): the window width and how far the content runs past the page (cut off / needs a sideways scroll).
 * Only numbers and the screen's address leave the browser (the server removes ids and the query string); no name, e-mail or user id. At most 40 reports per tab.
 * Failures are ignored: measuring must never disturb the page.
 */
const MAX_REPORTS = 40

function send(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify(payload)
    if (navigator.sendBeacon && navigator.sendBeacon('/api/rum', new Blob([body], { type: 'application/json' }))) return
    void fetch('/api/rum', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
  } catch { /* ignore */ }
}

export function RumReporter() {
  const pathname = usePathname()
  const sent = useRef(0)
  const seen = useRef(new Set<string>())

  // speed of the full page load: gathered by the browser itself, reported once
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return
    const landing = window.location.pathname   // the screen this full page load started on
    let lcp: number | null = null
    let cls = 0
    let inp = 0
    const observers: PerformanceObserver[] = []
    const watch = (type: string, cb: (entries: PerformanceEntryList) => void, extra: Record<string, unknown> = {}) => {
      try {
        const o = new PerformanceObserver((l) => cb(l.getEntries()))
        o.observe({ type, buffered: true, ...extra } as PerformanceObserverInit)
        observers.push(o)
      } catch { /* this browser does not offer it */ }
    }
    watch('largest-contentful-paint', (es) => { const last = es[es.length - 1] as PerformanceEntry | undefined; if (last) lcp = last.startTime })
    watch('layout-shift', (es) => { for (const e of es as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) cls += e.value })
    watch('event', (es) => { for (const e of es as unknown as { duration: number; interactionId?: number }[]) if ((e.interactionId ?? 0) > 0 && e.duration > inp) inp = e.duration }, { durationThreshold: 40 })

    let done = false
    const flush = () => {
      if (done || sent.current >= MAX_REPORTS) return
      done = true
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      send({
        kind: 'vitals', route: landing, viewport_w: window.innerWidth,
        ttfb_ms: nav && nav.responseStart > 0 ? nav.responseStart : undefined,
        load_ms: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : undefined,
        lcp_ms: lcp ?? undefined, cls: Math.round(cls * 1000) / 1000, inp_ms: inp > 0 ? inp : undefined,
      })
      sent.current++
    }
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    const timer = window.setTimeout(flush, 15_000)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      observers.forEach((o) => o.disconnect())
    }
  }, [])

  // does each screen fit the window? once per screen per tab
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (sent.current >= MAX_REPORTS || seen.current.has(pathname)) return
      seen.current.add(pathname)
      const main = document.getElementById('main-content')
      const over = Math.max(main ? main.scrollWidth - main.clientWidth : 0, document.documentElement.scrollWidth - window.innerWidth, 0)
      send({ kind: 'layout', route: pathname, viewport_w: window.innerWidth, overflow_px: over > 1 ? Math.round(over) : 0 })
      sent.current++
    }, 2500)
    return () => window.clearTimeout(t)
  }, [pathname])

  return null
}
