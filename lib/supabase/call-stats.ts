// Counts how the app's calls to its data services (database, sign-in, files) went, for the Health & Performance page: how many, how many were slow, how many needed a
// second try because the first one hung, how many ran out of time. Only numbers are kept, never a URL or a value. The app's start-up file reads and clears the counters
// every 10 minutes (instrumentation.ts) and stores them as health_metrics. No dependencies on purpose: the shared fetch wrapper also runs in the browser.

/** A call that takes this long counts as slow. */
export const SLOW_CALL_MS = 3_000

export type CallStats = {
  calls: number
  /** answered, but only after SLOW_CALL_MS or more */
  slow: number
  /** a second copy of a read was sent because the first had not answered in time */
  hedged: number
  /** the second copy answered first (the first one was stuck) */
  hedgeWon: number
  /** no answer within the time limit */
  timeouts: number
  /** the longest successful call, in milliseconds */
  maxMs: number
}

const empty = (): CallStats => ({ calls: 0, slow: 0, hedged: 0, hedgeWon: 0, timeouts: 0, maxMs: 0 })
let current = empty()

export function recordCall(ms: number, outcome: { hedged?: boolean; hedgeWon?: boolean; timedOut?: boolean }): void {
  current.calls++
  if (outcome.timedOut) { current.timeouts++; return }
  if (ms >= SLOW_CALL_MS) current.slow++
  if (outcome.hedged) current.hedged++
  if (outcome.hedgeWon) current.hedgeWon++
  if (ms > current.maxMs) current.maxMs = Math.round(ms)
}

/** The counters since the last call; starts counting again from zero. */
export function takeCallStats(): CallStats {
  const out = current
  current = empty()
  return out
}

/** For tests. */
export const resetCallStats = (): void => { current = empty() }
