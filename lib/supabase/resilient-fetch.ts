/**
 * A fetch wrapper for the Supabase clients (auth/REST/storage) that tolerates
 * a slow or momentarily-flaky backend instead of surfacing a raw network
 * error straight to the user.
 *
 * Retries only on connection-level failures (dropped/reset socket, or our own
 * timeout aborting because nothing came back in time) - never on a response
 * the server actually sent, even an error one like 401/500. A real "wrong
 * password" or "row not found" must reach the caller on the first try; only
 * "we don't know if the server even saw this yet" is worth retrying.
 */

import { reportFailure, reportResponse } from '@/lib/syslog/failure-reporter'

const TIMEOUT_MS = 20_000
const MAX_RETRIES = 2
const RETRY_DELAY_MS = [250, 750]

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (err instanceof TypeError) return true // fetch's own "network error" / "fetch failed"
  const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code
  // EADDRINUSE here is an outbound-connect failure (ephemeral local port
  // exhaustion/collision under high concurrent internal traffic), not a
  // real "address in use" bind conflict - a port frees up within
  // milliseconds, so this is exactly as transient as ECONNRESET/ETIMEDOUT.
  // Confirmed on Main under target-scale load testing: without this, a
  // burst of concurrent internal PostgREST calls surfaced as hard failures
  // (and, one level up, got misreported as "Service not found"/"Requester
  // not found" by create-request-core.ts's error-vs-not-found checks)
  // instead of self-healing via the retry this function already does for
  // equally transient conditions.
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EADDRINUSE'
}

/**
 * Whether a failed attempt may be sent again (audit D-043). A read can always be repeated. A write (POST / PATCH / PUT / DELETE) may have been
 * applied before the connection broke or the time ran out, so repeating it could create a second row or apply a change twice; it is only
 * repeated when the failure proves the server never received it (the connection was refused, or no local port was available to connect with).
 */
export function canRetry(method: string | undefined, err: unknown): boolean {
  if (!isRetryableError(err)) return false
  const m = (method ?? 'GET').toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true
  const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code
  return code === 'ECONNREFUSED' || code === 'EADDRINUSE'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const resilientFetch: typeof fetch = async (input, init) => {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // Respect a caller-supplied signal (e.g. React Query cancellation)
    // alongside our own timeout - either can abort the request.
    init?.signal?.addEventListener('abort', () => controller.abort())

    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const started = Date.now()
    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      clearTimeout(timeout)
      // a failed answer from the database / auth / storage service is recorded (in the background) in the System Log
      reportResponse(response, { url, method, ms: Date.now() - started })
      return response
    } catch (err) {
      clearTimeout(timeout)
      lastError = err

      if (!canRetry(init?.method ?? (input instanceof Request ? input.method : undefined), err) || attempt === MAX_RETRIES) {
        reportFailure({ url, method, error: err, ms: Date.now() - started })
        throw err
      }
      await sleep(RETRY_DELAY_MS[attempt])
    }
  }

  throw lastError
}
