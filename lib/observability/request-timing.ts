// How long every request to the app takes, per route (load review of 4 Nov 2026: the logged-in page times could not be measured from outside, so the server now records them).
//  - a request slower than SLOW_MS is written to the log at once (route and time only);
//  - every WINDOW_MS one line with the per-route figures of the last window (how many, median, 95th percentile, slowest, how many failed with a 5xx) is written.
// Nothing personal is recorded: the route has its ids and the query string removed (/requests/<uuid>?tab=x becomes /requests/:id), and static files are left out.
// The lines go to the app's normal output log (CkDeskApp.out.log) as JSON, so they can be read with a text search ("request_timing" / "slow_request").
// Switched off with REQUEST_TIMING=0. Node runtime only.

export const SLOW_MS = 1500
export const WINDOW_MS = 10 * 60_000
const MAX_SAMPLES_PER_ROUTE = 500
const MAX_ROUTES = 200

/** The route without ids or query: /requests/123e4567-e89b-12d3-a456-426614174000?x=1 -> /requests/:id ; /api/pms/20261104 -> /api/pms/:n. Static assets give null (not recorded). */
export function normalizeRoute(url: string | undefined): string | null {
  const path = (url ?? '/').split('?')[0].split('#')[0] || '/'
  if (path.startsWith('/_next/static') || path === '/favicon.ico') return null
  const out = path.split('/').map((seg) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id'
    if (/^\d{2,}$/.test(seg)) return ':n'
    if (/^[0-9a-f]{24,}$/i.test(seg)) return ':id'
    if (/^[A-Z]{2,6}-\d+$/.test(seg)) return ':no'   // a ticket number such as CKSD-000741
    return seg
  }).join('/')
  return out.length > 120 ? out.slice(0, 120) : out
}

export type RouteStats = { route: string; method: string; n: number; p50: number; p95: number; max: number; errors5xx: number; totalMs: number }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

export function createTimingCollector() {
  const routes = new Map<string, { route: string; method: string; ms: number[]; errors5xx: number; n: number; totalMs: number; maxMs: number }>()
  return {
    record(method: string, route: string, status: number, ms: number) {
      const key = `${method} ${route}`
      let r = routes.get(key)
      if (!r) {
        if (routes.size >= MAX_ROUTES) return   // an unexpected flood of distinct routes must not grow memory
        r = { route, method, ms: [], errors5xx: 0, n: 0, totalMs: 0, maxMs: 0 }
        routes.set(key, r)
      }
      r.n++; r.totalMs += ms; if (ms > r.maxMs) r.maxMs = ms
      if (status >= 500) r.errors5xx++
      if (r.ms.length < MAX_SAMPLES_PER_ROUTE) r.ms.push(ms)
    },
    /** The figures of the window so far, busiest (by total time) first; empties the collector. */
    flush(top = 15): RouteStats[] {
      const out = [...routes.values()].map((r) => {
        const sorted = [...r.ms].sort((a, b) => a - b)
        return { route: r.route, method: r.method, n: r.n, p50: Math.round(percentile(sorted, 50)), p95: Math.round(percentile(sorted, 95)), max: Math.round(r.maxMs), errors5xx: r.errors5xx, totalMs: Math.round(r.totalMs) }
      }).sort((a, b) => b.totalMs - a.totalMs).slice(0, top)
      routes.clear()
      return out
    },
    size: () => routes.size,
  }
}

type ServerLike = { prototype: { emit: (event: string, ...args: unknown[]) => boolean } }
type Log = { log: (line: string) => void; warn: (line: string) => void }

/** Wraps the HTTP server's request event. `httpServer` is node's http.Server; `log` and the timings are injectable so a test can use its own. */
export function installRequestTiming(opts: { httpServer: ServerLike; log?: Log; slowMs?: number; windowMs?: number; now?: () => number } ): { stop: () => void; flushNow: () => void } {
  const log = opts.log ?? console
  const slowMs = opts.slowMs ?? SLOW_MS
  const now = opts.now ?? (() => performance.now())
  const collector = createTimingCollector()
  const proto = opts.httpServer.prototype
  const original = proto.emit

  proto.emit = function patchedEmit(this: unknown, event: string, ...args: unknown[]): boolean {
    if (event === 'request') {
      try {
        const req = args[0] as { method?: string; url?: string }
        const res = args[1] as { once: (e: string, f: () => void) => void; statusCode?: number; writableFinished?: boolean }
        const route = normalizeRoute(req.url)
        if (route) {
          const method = req.method ?? 'GET'
          const start = now()
          let done = false
          res.once('finish', () => {
            if (done) return
            done = true
            const ms = now() - start
            const status = res.statusCode ?? 0
            collector.record(method, route, status, ms)
            if (ms >= slowMs) log.warn(JSON.stringify({ slow_request: { method, route, status, ms: Math.round(ms) } }))
          })
        }
      } catch { /* timing must never break a request */ }
    }
    return original.call(this, event, ...args)
  }

  const flushNow = () => {
    const stats = collector.flush()
    if (stats.length > 0) log.log(JSON.stringify({ request_timing: { window_min: Math.round((opts.windowMs ?? WINDOW_MS) / 60_000), routes: stats } }))
  }
  const timer = setInterval(flushNow, opts.windowMs ?? WINDOW_MS)
  if (typeof timer.unref === 'function') timer.unref()
  return { flushNow, stop: () => { clearInterval(timer); proto.emit = original } }
}
