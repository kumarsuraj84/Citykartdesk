// The app's own pulse, kept every 10 minutes next to the per-page speed figures (instrumentation.ts) and shown on the Health & Performance page:
//  - event loop pause: the longest time the app was "frozen" (busy with one piece of work, so it could answer nobody). A long pause here, with the servers calm, points at the app itself.
//  - the calls to the data services: how many were slow (3 s or more), how many needed a second copy because the first was stuck, how many ran out of time (lib/supabase/call-stats.ts).
// Only numbers are stored. Never throws and never slows a request. No 'server-only' import on purpose (used from the start-up file).
import { takeCallStats, type CallStats } from '@/lib/supabase/call-stats'

export type Vitals = {
  /** longest event-loop pause in the window, milliseconds */
  loopMaxMs: number
  /** the pause that 99% of the moments stayed under, milliseconds */
  loopP99Ms: number
  calls: CallStats
}

type Histogram = { max: number; percentile: (p: number) => number; reset: () => void; enable: () => boolean }
let histogram: Histogram | null = null

/** Starts measuring the event loop (once). Safe to call again. Returns false where it cannot be measured. */
export function startVitals(): boolean {
  if (histogram) return true
  try {
    // (process.getBuiltinModule, not an import: the start-up file is also built for the Edge runtime, which refuses a 'node:' import)
    const perf = (process as unknown as { getBuiltinModule?: (id: string) => { monitorEventLoopDelay?: (o: { resolution: number }) => Histogram } | undefined }).getBuiltinModule?.('node:perf_hooks')
    if (!perf?.monitorEventLoopDelay) return false
    histogram = perf.monitorEventLoopDelay({ resolution: 20 })
    histogram.enable()
    return true
  } catch { return false }
}

const toMs = (ns: number) => (Number.isFinite(ns) ? Math.round(ns / 1e6) : 0)

/** The figures since the last call, and starts the next window. */
export function takeVitals(): Vitals {
  const calls = takeCallStats()
  let loopMaxMs = 0
  let loopP99Ms = 0
  if (histogram) {
    loopMaxMs = toMs(histogram.max)
    loopP99Ms = toMs(histogram.percentile(99))
    histogram.reset()
  }
  return { loopMaxMs, loopP99Ms, calls }
}

/** The rows stored in health_metrics for one window. */
export function vitalsToMetrics(v: Vitals): { metric: string; value: number }[] {
  return [
    { metric: 'loop_max_ms', value: v.loopMaxMs },
    { metric: 'loop_p99_ms', value: v.loopP99Ms },
    { metric: 'data_calls', value: v.calls.calls },
    { metric: 'data_slow', value: v.calls.slow },
    { metric: 'data_hedged', value: v.calls.hedged },
    { metric: 'data_timeouts', value: v.calls.timeouts },
    { metric: 'data_max_ms', value: v.calls.maxMs },
  ]
}

export async function storeVitals(): Promise<void> {
  try {
    const rows = vitalsToMetrics(takeVitals())
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient() as unknown as { from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: unknown }> } }
    await admin.from('health_metrics').insert(rows)
  } catch { /* the pulse is a bonus: never a reason to disturb the app */ }
}
