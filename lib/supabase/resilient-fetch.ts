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

const TIMEOUT_MS = 20_000
const MAX_RETRIES = 2
const RETRY_DELAY_MS = [250, 750]

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (err instanceof TypeError) return true // fetch's own "network error" / "fetch failed"
  const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT'
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

    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      clearTimeout(timeout)
      return response
    } catch (err) {
      clearTimeout(timeout)
      lastError = err

      if (!isRetryableError(err) || attempt === MAX_RETRIES) {
        throw err
      }
      await sleep(RETRY_DELAY_MS[attempt])
    }
  }

  throw lastError
}
