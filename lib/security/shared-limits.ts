// Limits and replay guards that are shared by every application process and survive a restart (migration 170), for the public endpoints where a
// per-process counter is not enough (VAPT-042, 044, 051, 065). The server's own key is used; nothing here is reachable by a signed-in user.
//
// If the database objects are not there yet (the application is live before migration 170) or the call fails, the in-memory limiter is used instead
// and the replay guard lets the delivery through: availability of a mailbox or approval link must not depend on this extra protection.
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/observability/logger'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { code?: string; message?: string } | null }> }

/** True when the caller is OVER the limit. `key` should carry what is limited (for example `approval-code:<approval id>:<approver id>`). */
export async function sharedRateLimited(key: string, limit: number, windowSeconds: number, client?: Rpc): Promise<boolean> {
  try {
    const db = client ?? (createAdminClient() as unknown as Rpc)
    const { data, error } = await db.rpc('rate_limit_hit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
    if (error) throw new Error(error.message ?? error.code ?? 'rate_limit_hit failed')
    return data === true
  } catch (e) {
    logger.warn({ event: 'security.shared_limit_fallback', message: 'The shared limiter was not available; using the in-memory one', route: 'lib/security/shared-limits.ts', context: { error: e instanceof Error ? e.message : String(e) } })
    return (await rateLimit(`fallback:${key}`, limit, windowSeconds * 1000)).limited
  }
}

/**
 * Adds `amount` (a size, in whatever unit the caller chose) to a running total kept in the database and says whether the total inside the window is now OVER the
 * limit (migration 192, quota_add). If the database function is not there yet the in-memory totals below are used, so uploads do not stop working before the migration.
 */
const memoryTotals = new Map<string, { total: number; resetAt: number }>()
export async function sharedQuotaExceeded(key: string, amount: number, limit: number, windowSeconds: number, client?: Rpc): Promise<boolean> {
  amount = Math.max(0, Math.ceil(amount))
  try {
    const db = client ?? (createAdminClient() as unknown as Rpc)
    const { data, error } = await db.rpc('quota_add', { p_key: key, p_amount: amount, p_limit: limit, p_window_seconds: windowSeconds })
    if (error) throw new Error(error.message ?? error.code ?? 'quota_add failed')
    return data === true
  } catch (e) {
    logger.warn({ event: 'security.shared_limit_fallback', message: 'The shared quota counter was not available; using the in-memory one', route: 'lib/security/shared-limits.ts', context: { error: e instanceof Error ? e.message : String(e) } })
    const now = Date.now()
    const cur = memoryTotals.get(key)
    const entry = !cur || cur.resetAt < now ? { total: 0, resetAt: now + windowSeconds * 1000 } : cur
    entry.total += amount
    memoryTotals.set(key, entry)
    if (memoryTotals.size > 20_000) for (const [k, v] of memoryTotals) if (v.resetAt < now) memoryTotals.delete(k)
    return entry.total > limit
  }
}

/** True the first time a delivery key is seen inside the window; false for a repeat (a replay). Lets the delivery through if the guard is unavailable. */
export async function firstDelivery(key: string, windowSeconds: number, client?: Rpc): Promise<boolean> {
  try {
    const db = client ?? (createAdminClient() as unknown as Rpc)
    const { data, error } = await db.rpc('webhook_seen_once', { p_key: key, p_ttl_seconds: windowSeconds })
    if (error) throw new Error(error.message ?? error.code ?? 'webhook_seen_once failed')
    return data === true
  } catch (e) {
    logger.warn({ event: 'security.replay_guard_unavailable', message: 'The replay guard was not available; the delivery is let through', route: 'lib/security/shared-limits.ts', context: { error: e instanceof Error ? e.message : String(e) } })
    return true
  }
}
