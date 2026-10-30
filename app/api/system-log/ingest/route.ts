import { NextRequest, NextResponse } from 'next/server'
import { secureCompare } from '@/lib/secure-compare'
import { flushSystemLog, recordSystemLog } from '@/lib/syslog/record'
import { isSeverity, isSource, type Source, type Severity } from '@/lib/syslog/shape'
import { getSecret } from '@/lib/secrets'

// Lets things OUTSIDE the app add error rows to the System Log: the cron runner (a job failed, or the app could not be reached) and the log
// shipper (PostgREST / auth / storage / PostgreSQL log lines). Authenticated with a shared secret (x-system-log-secret, or the cron secret for 'cron' entries only),
// never with a session. It can only add `error` and `event` rows from the sources below: nothing that arrives here can write to the audit
// trail, so the hash-chained records stay exclusively the server's own.

const MAX_BODY = 512 * 1024
const MAX_ENTRIES = 200
const SOURCES_ALLOWED = new Set<Source>(['cron', 'database', 'storage', 'auth', 'integration', 'process', 'shipper', 'app_server'])

// Two secrets are understood, with different reach:
//   - SYSTEM_LOG_INGEST_SECRET (the log shipper's own): may add entries from any of the sources above;
//   - CRON_SECRET (the cron runner has no other): may add ONLY entries whose source is 'cron', so a learned cron secret cannot be used to write
//     fake database / auth / storage fault lines into the log.
// Both need at least 16 characters and are compared in constant time.
type Reach = 'all' | 'cron_only'
function authorized(req: NextRequest): Reach | false | null {
  const usable = (s: string | null) => (typeof s === 'string' && s.length >= 16 ? s : null)
  const ingest = usable(getSecret('system_log_ingest'))
  const cron = usable(getSecret('cron'))
  if (!ingest && !cron) return null
  const given = req.headers.get('x-system-log-secret') ?? req.headers.get('x-cron-secret') ?? (req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : '')
  if (ingest && secureCompare(given, ingest)) return 'all'
  if (cron && secureCompare(given, cron)) return 'cron_only'
  return false
}

export async function POST(req: NextRequest) {
  const reach = authorized(req)
  if (reach === null) return NextResponse.json({ error: 'No ingest secret is configured.' }, { status: 503 })
  if (!reach) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { entries?: unknown }
  try {
    const text = await req.text()
    if (text.length > MAX_BODY) return NextResponse.json({ error: 'Too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (!Array.isArray(body.entries)) return NextResponse.json({ error: 'entries must be a list' }, { status: 400 })

  let accepted = 0
  let refused = 0
  for (const raw of body.entries.slice(0, MAX_ENTRIES)) {
    const e = raw as Record<string, unknown>
    if (!e || typeof e !== 'object' || typeof e.action !== 'string' || !e.action) continue
    if (reach === 'cron_only' && e.source !== 'cron') { refused++; continue }   // the cron secret reaches the 'cron' source only
    const source: Source = isSource(e.source) && SOURCES_ALLOWED.has(e.source) ? e.source : 'shipper'
    const severity: Severity = isSeverity(e.severity) ? e.severity : 'error'
    await recordSystemLog({
      category: e.category === 'event' ? 'event' : 'error',
      source, severity,
      action: String(e.action).slice(0, 200),
      message: typeof e.message === 'string' ? e.message : null,
      errorCode: typeof e.errorCode === 'string' ? e.errorCode : null,
      stack: typeof e.stack === 'string' ? e.stack : null,
      path: typeof e.path === 'string' ? e.path : null,
      detail: e.detail,
      at: typeof e.at === 'number' && Math.abs(Date.now() - e.at) < 24 * 3600_000 ? e.at : undefined,
      // a shipper may carry the log's own timestamps, but never someone else's identity or an organization
      actorId: null, orgId: null,
    }, { floodKey: `ingest|${source}|${String(e.errorCode ?? '')}|${String(e.message ?? e.action).slice(0, 80)}` })
    accepted++
  }
  await flushSystemLog()
  if (reach === 'cron_only' && refused > 0 && accepted === 0) return NextResponse.json({ error: "The cron secret may only add entries whose source is 'cron'." }, { status: 403 })
  return NextResponse.json(refused > 0 ? { ok: true, accepted, refused } : { ok: true, accepted })
}
