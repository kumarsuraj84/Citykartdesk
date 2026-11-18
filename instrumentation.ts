import type { Instrumentation } from 'next'

// Runs once when the Next.js server starts, and on every unhandled server error. Both feed the System Log
// (see docs/superpowers/specs/2026-10-14-system-log-design.md). Node runtime only; the proxy and pages run there.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { installProcessHandlers } = await import('./lib/syslog/process')
  installProcessHandlers()
  // Once at start: name every missing / weak secret and a wrong time zone in the log (never a value, never a crash). Before this a missing purpose secret
  // just switched its feature off with no sign anywhere.
  // How long every request takes, per route (slow ones at once, a summary every 10 minutes): lib/observability/request-timing.ts. Off with REQUEST_TIMING=0.
  try {
    if (process.env.REQUEST_TIMING !== '0' && !(globalThis as { __ckRequestTiming?: boolean }).__ckRequestTiming) {
      ;(globalThis as { __ckRequestTiming?: boolean }).__ckRequestTiming = true
      // (process.getBuiltinModule, not an import: the bundler also builds this file for the Edge runtime and refuses a 'node:' import there)
      const http = (process as unknown as { getBuiltinModule?: (id: string) => { Server: unknown } | undefined }).getBuiltinModule?.('node:http')
      if (http) {
        const { installRequestTiming } = await import('./lib/observability/request-timing')
        // the per-route figures are also kept in the database for the platform owners' Health & Performance page (lib/observability/perf-store.ts; fire and forget)
        installRequestTiming({ httpServer: http.Server as never, onWindow: (stats) => { void import('./lib/observability/perf-store').then((m) => m.storeWindow(stats)).catch(() => {}) } })
      }
    }
  } catch { /* timing must never stop the server from starting */ }
  // The app's own pulse (longest freeze of the app, slow / stuck / timed-out calls to the data services), stored every 10 minutes for the Health & Performance page.
  try {
    if (process.env.REQUEST_TIMING !== '0' && !(globalThis as { __ckVitals?: boolean }).__ckVitals) {
      ;(globalThis as { __ckVitals?: boolean }).__ckVitals = true
      const vitals = await import('./lib/observability/app-vitals')
      if (vitals.startVitals()) {
        const timer = setInterval(() => { void vitals.storeVitals() }, 10 * 60_000)
        if (typeof timer.unref === 'function') timer.unref()
      }
    }
  } catch { /* the pulse must never stop the server from starting */ }
  try {
    const { startupWarnings } = await import('./lib/observability/startup-check')
    for (const w of startupWarnings()) console.warn(`[startup] ${w}`)
  } catch { /* a check must never stop the server from starting */ }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { recordRequestError } = await import('./lib/syslog/process')
  await recordRequestError(err, request, context)
}
