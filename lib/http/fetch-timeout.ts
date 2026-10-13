// fetch() with a time limit (audit D-046). A call to an outside service that never answers would otherwise hold the request, a server-action or a
// background job open until the platform gives up. Other signals passed by the caller still work: either one can cancel the call.

export const OUTBOUND_TIMEOUT_MS = 20_000

export function fetchWithTimeout(input: string | URL | Request, init: RequestInit = {}, timeoutMs: number = OUTBOUND_TIMEOUT_MS): Promise<Response> {
  const limit = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit
  return fetch(input, { ...init, signal })
}
