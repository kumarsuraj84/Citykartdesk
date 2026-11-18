// Keeps the per-page speed figures the app already counts every 10 minutes (lib/observability/request-timing.ts) in the database, for the Health & Performance page.
// Never throws and never slows a request: a failed write is dropped (the log line still has the figures). Used only from the app's start-up file; no 'server-only' import on
// purpose (the start-up file is also built for the Edge runtime, where it never runs this).
import type { RouteStats } from './request-timing'

let warned = false

export async function storeWindow(stats: RouteStats[]): Promise<void> {
  try {
    if (!stats.length) return
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient() as unknown as { from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }> } }
    const { error } = await admin.from('perf_windows').insert(stats.map((s) => ({ route: s.route, method: s.method, n: s.n, p50: s.p50, p95: s.p95, max: s.max, errors5xx: s.errors5xx })))
    if (error && !warned) { warned = true; console.warn(`[perf] page speed figures were not stored: ${error.message.slice(0, 120)} (is migration 200 applied?)`) }
  } catch { /* speed figures are a bonus: never a reason to disturb the app */ }
}
