import { NextRequest, NextResponse } from 'next/server'
import { recordSystemLog } from '@/lib/syslog/record'
import { rateLimit } from '@/lib/rate-limit'

// Where the browser sends Content-Security-Policy violation reports (lib/http/csp.ts). Anyone can post here, so it is small and cheap: the
// body is capped, each address is rate-limited, identical reports collapse into one row, and nothing is stored except what the browser says
// it blocked and on which page. It never reads a session and never fails loudly: a browser does not care what answers.

const MAX_BODY = 8 * 1024

const short = (v: unknown, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '')
/** Only the origin and path of an address: a query string can carry tokens. */
const bare = (v: unknown) => { const s = short(v, 500); try { const u = new URL(s); return `${u.origin}${u.pathname}` } catch { return s.split('?')[0] } }

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  if ((await rateLimit(`csp-report:${ip}`, 30, 60_000)).limited) return new NextResponse(null, { status: 204 })

  let report: Record<string, unknown> | null = null
  try {
    const text = await req.text()
    if (text.length > MAX_BODY) return new NextResponse(null, { status: 204 })
    const j = JSON.parse(text)
    // the older format wraps it in "csp-report"; the newer one is a list of {type, body}
    report = (Array.isArray(j) ? j.find((x) => x?.type === 'csp-violation')?.body : (j?.['csp-report'] ?? j)) ?? null
  } catch { /* not a report */ }
  if (!report || typeof report !== 'object') return new NextResponse(null, { status: 204 })

  const directive = short(report['violated-directive'] ?? report['effectiveDirective'] ?? report['effective-directive'], 80)
  const blocked = bare(report['blocked-uri'] ?? report['blockedURL'] ?? report['blocked-url'])
  const page = bare(report['document-uri'] ?? report['documentURL'] ?? report['document-url'])
  if (!directive) return new NextResponse(null, { status: 204 })

  await recordSystemLog({
    category: 'event', source: 'browser', severity: 'warning', action: 'security.csp_violation',
    message: `The page would have been blocked from loading "${blocked || 'inline content'}" (${directive})`,
    path: page.replace(/^https?:\/\/[^/]+/, '') || null,
    detail: { directive, blocked, source_file: bare(report['source-file'] ?? report['sourceFile']), line: report['line-number'] ?? report['lineNumber'] ?? null },
    actorId: null, orgId: null,
  }, { floodKey: `csp|${directive}|${blocked}|${page}` })
  return new NextResponse(null, { status: 204 })
}
