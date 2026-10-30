import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { currentBuild } from '@/lib/http/build-info'

export const dynamic = 'force-dynamic'

// Uses the service-role client, not the anon-key createClient() the rest of the app
// uses — `anon` has no table grants at all (by design, RLS-only access), so an
// anon-scoped query here would always fail with "permission denied" and report
// this endpoint as unhealthy even when the app and DB are working correctly. This
// endpoint only needs to prove DB connectivity, not exercise a real user's access.
// A caller on the Internet can ask this route as often as it likes. The answer is therefore kept for a few seconds and shared, so the database is asked at
// most once per interval whatever the number of callers (VAPT-066 / VA-API-14). The reply carries no version or detail beyond what monitoring needs.
//
// GET /api/health          cheap: the database (PostgREST) only; open to everyone
// GET /api/health?deep=1   also the sign-in service (GoTrue /auth/v1/health) and the file service (/storage/v1/); needs the cron secret
//                          (x-cron-secret or Authorization: Bearer) because it makes the app call the other services. Not cached.
const CACHE_MS = 5000
const PROBE_MS = 4000
let cached: { at: number; status: number; body: Record<string, unknown> } | null = null

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('deep') === '1') {
    const verified = verifyCronSecret(req)
    if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    const res = await checkDeep()
    return NextResponse.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } })
  }
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) {
    return NextResponse.json({ ...cached.body, cached: true }, { status: cached.status, headers: { 'Cache-Control': 'no-store' } })
  }
  const res = await check()
  cached = { at: Date.now(), status: res.status, body: res.body }
  return NextResponse.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } })
}

async function check(): Promise<{ status: number; body: Record<string, unknown> }> {
  const start = Date.now()

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('profiles').select('id').limit(1).maybeSingle()

    if (error) {
      console.error('[health] DB check failed:', error.message)
      return { status: 503, body: { status: 'degraded', db: 'error', latency_ms: Date.now() - start } }
    }

    // npm_package_version is not set in the standalone server (it was always "0.0.1"): the build id stamped at build time says what is running
    return { status: 200, body: { status: 'ok', db: 'ok', latency_ms: Date.now() - start, version: currentBuild().buildId } }
  } catch (err) {
    console.error('[health] Unexpected error:', err)
    return { status: 503, body: { status: 'error', latency_ms: Date.now() - start } }
  }
}

/** One service answers = any HTTP answer below 500 (the storage root answers 4xx without a key, which still proves it is up). */
async function probe(url: string): Promise<'ok' | 'error'> {
  try {
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    const res = await fetch(url, { headers: anon ? { apikey: anon } : {}, signal: AbortSignal.timeout(PROBE_MS), cache: 'no-store' })
    return res.status < 500 ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

async function checkDeep(): Promise<{ status: number; body: Record<string, unknown> }> {
  const start = Date.now()
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const [dbRes, auth, storage] = await Promise.all([
    check(),
    base ? probe(`${base}/auth/v1/health`) : Promise.resolve('error' as const),
    base ? probe(`${base}/storage/v1/`) : Promise.resolve('error' as const),
  ])
  const db = dbRes.status === 200 ? 'ok' : 'error'
  const all = db === 'ok' && auth === 'ok' && storage === 'ok'
  const b = currentBuild()
  return { status: all ? 200 : 503, body: { status: all ? 'ok' : 'degraded', db, auth, storage, latency_ms: Date.now() - start, version: b.buildId, ...(b.commit ? { commit: b.commit } : {}) } }
}
