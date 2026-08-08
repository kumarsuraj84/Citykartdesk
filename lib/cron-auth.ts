import type { NextRequest } from 'next/server'

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
 */
export function verifyCronSecret(req: NextRequest): boolean | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return null

  const authHeader = req.headers.get('authorization') ?? ''
  const legacyHeader = req.headers.get('x-cron-secret') ?? ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : legacyHeader
  return provided === cronSecret
}
