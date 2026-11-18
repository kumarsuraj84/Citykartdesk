import { NextRequest, NextResponse } from 'next/server'
import { secureCompare } from '@/lib/secure-compare'
import { isOverLimit, recordEvent } from '@/lib/rate-limit'
import { MIN_SECRET_LENGTH, getSecret } from '@/lib/secrets'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/observability/logger'
import { dbHostRows, parseDbHostReport } from '@/lib/health/db-host'

export const dynamic = 'force-dynamic'

// POST /api/health/db-host   called once a minute by the small read-only reporter on the database server (scripts/windows/db-host-agent.ps1).
// Body: { cpuPct, memTotalBytes, memFreeBytes, disks: [{ name, totalBytes, freeBytes }] }. Header: x-health-agent-secret: <HEALTH_AGENT_SECRET> (its own secret, never CRON_SECRET).
// Stores one sample per check (dbhost_cpu / dbhost_memory / dbhost_disk) and the chart numbers; the Health page and the outage rules do the rest. Without HEALTH_AGENT_SECRET the
// route is simply off (503), and the three checks show "Not in use". Answers carry no detail: nothing about the system goes to anyone without the secret.
const MAX_BODY_BYTES = 4_096
const FAILED_LIMIT = 20
const WINDOW_MS = 60_000
const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  const secret = getSecret('health_agent')
  if (!secret || secret.length < MIN_SECRET_LENGTH) return NextResponse.json({ error: 'HEALTH_AGENT_SECRET is not configured.' }, { status: 503, headers: noStore })

  const key = 'health-agent-fail|any'
  if (isOverLimit(key, FAILED_LIMIT)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  if (!secureCompare(req.headers.get('x-health-agent-secret') ?? '', secret)) {
    recordEvent(key, WINDOW_MS)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  }

  const text = await req.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413, headers: noStore })
  let body: unknown
  try { body = JSON.parse(text) } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: noStore }) }
  const report = parseDbHostReport(body)
  if (!report) return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: noStore })

  try {
    const { samples, metrics } = dbHostRows(report)
    const admin = createAdminClient() as unknown as { from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }> } }
    const s = await admin.from('health_samples').insert(samples)
    if (s.error) throw new Error(s.error.message)
    try { await admin.from('health_metrics').insert(metrics) } catch { /* charts only: never a reason to refuse the report */ }
    return NextResponse.json({ ok: true }, { headers: noStore })
  } catch (e) {
    logger.error({ event: 'health.db_host_failed', message: 'A report from the database server could not be stored', route: 'app/api/health/db-host/route.ts', errorCode: 'health_db_host_failed', error: e })
    return NextResponse.json({ ok: false }, { status: 500, headers: noStore })
  }
}
