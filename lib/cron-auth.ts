import type { NextRequest } from 'next/server'
import { secureCompare } from '@/lib/secure-compare'
import { isOverLimit, recordEvent } from '@/lib/rate-limit'
import { MIN_SECRET_LENGTH } from '@/lib/secrets'

/**
 * Shared secret check for cron/internal-trigger API routes.
 *
 * Two conventions are accepted: `x-cron-secret: <secret>` (what
 * scripts/cron-tick.mjs sends, and what's used for manual/local testing) and
 * `Authorization: Bearer <secret>` (what Vercel Cron sends — kept for
 * environments still wired that way). Checking both in one place means a
 * future cron route only has to call this, instead of every route
 * reimplementing — and potentially missing — one of the two conventions.
 *
 * Returns `null` if CRON_SECRET isn't configured (caller should 503),
 * `true`/`false` for whether the request's secret matches.
 *
 * Two protections against guessing (audit G-25):
 *  - a CRON_SECRET shorter than 16 characters counts as NOT configured (null), the same minimum every other purpose secret has (lib/secrets.ts);
 *  - after FAILED_LIMIT wrong secrets inside one minute from the same caller, every further request is answered "false" until the minute is over,
 *    even one carrying the right secret. The caller is the client address when TRUSTED_PROXY_HOPS tells us which address to believe; without it
 *    all callers share one counter (so a flood of wrong guesses can pause the jobs for a minute: the runner reports that and the next run works).
 */
const FAILED_LIMIT = 30
const WINDOW_MS = 60_000

/** The caller's address from a request, using the same trust rule as lib/rate-limit.ts getClientIp (only believed behind a configured proxy). */
function callerKey(req: NextRequest): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)
  if (!Number.isInteger(hops) || hops < 1) return 'cron-auth-fail|any'
  const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return `cron-auth-fail|${parts.length >= hops ? parts[parts.length - hops] : 'any'}`
}

let warnedShort = false

export function verifyCronSecret(req: NextRequest): boolean | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return null
  if (cronSecret.length < MIN_SECRET_LENGTH) {
    if (!warnedShort) { warnedShort = true; console.error(`[cron-auth] CRON_SECRET is shorter than ${MIN_SECRET_LENGTH} characters: scheduled jobs are refused until it is replaced`) }
    return null
  }

  const key = callerKey(req)
  if (isOverLimit(key, FAILED_LIMIT)) return false

  const authHeader = req.headers.get('authorization') ?? ''
  const legacyHeader = req.headers.get('x-cron-secret') ?? ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : legacyHeader
  const ok = secureCompare(provided, cronSecret)
  if (!ok) recordEvent(key, WINDOW_MS)
  return ok
}
