// A one-slot registry that lets the shared fetch wrappers (which also run in the browser) report failed calls without importing any
// server-only code. The server installs a reporter at start-up (instrumentation.ts -> lib/syslog/process.ts); in the browser another one
// may be installed; with none installed, reporting is a no-op. No dependencies on purpose.

export interface FailureReport {
  url: string
  method: string
  /** HTTP status, when a response arrived. */
  status?: number
  /** The error thrown, when no response arrived (connection refused, timeout...). */
  error?: unknown
  /** The first part of the response body, when a response arrived and the body could be read. */
  body?: string
  ms?: number
}

type Reporter = (r: FailureReport) => void
let reporter: Reporter | null = null

export function setFailureReporter(fn: Reporter | null): void { reporter = fn }
export const hasFailureReporter = (): boolean => reporter !== null

/** Never throws. */
export function reportFailure(r: FailureReport): void {
  try { reporter?.(r) } catch { /* reporting must never affect the call */ }
}

/** Report a response that may be a failure; reads a copy of the body in the background (never delays the caller). */
export function reportResponse(res: Response, info: { url: string; method: string; ms?: number }): void {
  if (!reporter || res.status < 400) return
  try {
    void res.clone().text().then((body) => reportFailure({ ...info, status: res.status, body: body.slice(0, 600) }), () => reportFailure({ ...info, status: res.status }))
  } catch {
    reportFailure({ ...info, status: res.status })
  }
}
