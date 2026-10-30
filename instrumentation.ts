import type { Instrumentation } from 'next'

// Runs once when the Next.js server starts, and on every unhandled server error. Both feed the System Log
// (see docs/superpowers/specs/2026-10-14-system-log-design.md). Node runtime only; the proxy and pages run there.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { installProcessHandlers } = await import('./lib/syslog/process')
  installProcessHandlers()
  // Once at start: name every missing / weak secret and a wrong time zone in the log (never a value, never a crash). Before this a missing purpose secret
  // just switched its feature off with no sign anywhere.
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
