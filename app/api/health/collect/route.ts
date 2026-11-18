import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { collectOnce } from '@/lib/health/collect'
import { logger } from '@/lib/observability/logger'

export const dynamic = 'force-dynamic'

// GET /api/health/collect   called every minute by the health probe on the app server (shared secret: x-cron-secret or Authorization: Bearer).
// Runs the app's own checks, stores them, and opens / closes outages. Returns counts only: no detail, nothing about the system to anyone who does not hold the secret.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  try {
    const r = await collectOnce()
    return NextResponse.json({ ok: true, checks: r.probes.length, opened: r.opened.length, closed: r.closed.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    logger.error({ event: 'health.collect_failed', message: 'A health collection round failed', route: 'app/api/health/collect/route.ts', errorCode: 'health_collect_failed', error: e })
    return NextResponse.json({ ok: false }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
