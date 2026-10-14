/**
 * A fetch wrapper for the Supabase clients (auth/REST/storage) that tolerates
 * a slow or momentarily-flaky backend instead of surfacing a raw network
 * error straight to the user.
 *
 * Retries only on FAST connection-level failures (a reset or refused socket) - never on a response the server actually sent, even an
 * error one like 401/500, and never after a timeout (a service that did not answer in 20 s will not answer a second time any faster, and
 * retrying turned one outage into minutes of spinner: audit REL-1). A real "wrong password" or "row not found" must reach the caller on
 * the first try; only "we don't know if the server even saw this yet" is worth retrying.
 *
 * Fast-fail breaker (REL-1): once a service (database, sign-in or storage API) has just failed after all its attempts, further calls to it
 * fail at once for a short while instead of each waiting out its own 20 seconds. A page that makes several calls in a row therefore shows
 * its error screen after about one timeout, not after one timeout per call, and a struggling service is not hammered meanwhile.
 */

import { reportFailure, reportResponse } from '@/lib/syslog/failure-reporter'

const TIMEOUT_MS = 20_000
const MAX_RETRIES = 2
const RETRY_DELAY_MS = [250, 750]

/** How long, after a service has failed, calls to it are refused immediately before ONE is let through to test it again (doubling, up to the maximum, while it keeps failing). */
export const BREAKER_MS = 5_000
const BREAKER_MAX_MS = 15_000
/** The test call is given a short time: the service is already known to be struggling. */
export const PROBE_TIMEOUT_MS = 4_000

function isRetryableError(err: unknown): boolean {
  // our own time limit, or the caller cancelling: not a transient glitch, so never repeated
  if (err instanceof DOMException && err.name === 'AbortError') return false
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
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EADDRINUSE'
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

// ── fast-fail breaker, one per service (origin + API prefix) ──
interface Breaker { until: number; fails: number; probing: boolean }
const breakers = new Map<string, Breaker>()

function serviceKey(url: string): string {
  try { const u = new URL(url); return `${u.origin}${/^\/(rest|auth|storage|realtime)\/v\d+/.exec(u.pathname)?.[0] ?? ''}` } catch { return url.slice(0, 60) }
}

/** 'go' = normal call; 'probe' = the one test call after the hold-off; 'refuse' = fail at once. */
function gate(key: string, now: number): 'go' | 'probe' | 'refuse' {
  const b = breakers.get(key)
  if (!b) return 'go'
  if (now < b.until || b.probing) return 'refuse'
  b.probing = true
  return 'probe'
}

function tripped(key: string, now: number) {
  const fails = (breakers.get(key)?.fails ?? 0) + 1
  breakers.set(key, { until: now + Math.min(BREAKER_MS * 2 ** (fails - 1), BREAKER_MAX_MS), fails, probing: false })
}

/** The call ended without proving anything either way (e.g. one reset on a write): let the next caller test the service. */
function undecided(key: string) { const b = breakers.get(key); if (b) b.probing = false }

/** For tests. */
export function resetBreakers() { breakers.clear() }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const resilientFetch: typeof fetch = async (input, init) => {
  let lastError: unknown
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const service = serviceKey(url)
  const mode = gate(service, Date.now())
  if (mode === 'refuse') {
    // code ABORT_ERR is what tells the Supabase database client not to run its own retries (1 s, 2 s, 4 s) on top of this: it would only wait
    throw Object.assign(new TypeError('fetch failed'), { code: 'ABORT_ERR', cause: { code: 'ECIRCUITOPEN', message: 'The service failed a moment ago; not trying again yet.' } })
  }
  const attempts = mode === 'probe' ? 0 : MAX_RETRIES   // the test call is not repeated

  for (let attempt = 0; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, mode === 'probe' ? PROBE_TIMEOUT_MS : TIMEOUT_MS)

    // Respect a caller-supplied signal (e.g. React Query cancellation)
    // alongside our own timeout - either can abort the request.
    init?.signal?.addEventListener('abort', () => controller.abort())

    const started = Date.now()
    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      clearTimeout(timeout)
      // the gateway in front of the services answers 502 / 503 / 504 when the service behind it is down (often slowly): treat that like a
      // failure for the next few calls, but hand the answer itself back unchanged. Any other answer means the service is alive.
      if (response.status === 502 || response.status === 503 || response.status === 504) tripped(service, Date.now())
      else breakers.delete(service)
      // a failed answer from the database / auth / storage service is recorded (in the background) in the System Log
      reportResponse(response, { url, method, ms: Date.now() - started })
      return response
    } catch (err) {
      clearTimeout(timeout)
      lastError = err

      if (!canRetry(init?.method ?? (input instanceof Request ? input.method : undefined), err) || attempt === attempts) {
        reportFailure({ url, method, error: err, ms: Date.now() - started })
        // the service did not answer in time, or kept refusing / dropping connections: hold off the next calls to it for a moment
        // (one reset on a single write does not count: that call was simply not repeated)
        if (timedOut || mode === 'probe' || (attempt === attempts && canRetry(init?.method, err)) || (err as { cause?: { code?: string } })?.cause?.code === 'ECONNREFUSED') tripped(service, Date.now())
        else undecided(service)
        throw err
      }
      await sleep(RETRY_DELAY_MS[attempt])
    }
  }

  throw lastError
}
