// fetch() with a time limit (audit D-046). A call to an outside service that never answers would otherwise hold the request, a server-action or a
// background job open until the platform gives up. Other signals passed by the caller still work: either one can cancel the call.

import { reportFailure, reportResponse } from '@/lib/syslog/failure-reporter'

export const OUTBOUND_TIMEOUT_MS = 20_000

export function fetchWithTimeout(input: string | URL | Request, init: RequestInit = {}, timeoutMs: number = OUTBOUND_TIMEOUT_MS): Promise<Response> {
  const limit = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = init.method ?? 'GET'
  const started = Date.now()
  // a failed call to an outside service (e-mail, mailbox, time tracking...) is recorded in the System Log, in the background
  return fetch(input, { ...init, signal }).then(
    (res) => { reportResponse(res, { url, method, ms: Date.now() - started }); return res },
    (err) => { reportFailure({ url, method, error: err, ms: Date.now() - started }); throw err },
  )
}
