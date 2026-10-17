import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Uses the service-role client, not the anon-key createClient() the rest of the app
// uses — `anon` has no table grants at all (by design, RLS-only access), so an
// anon-scoped query here would always fail with "permission denied" and report
// this endpoint as unhealthy even when the app and DB are working correctly. This
// endpoint only needs to prove DB connectivity, not exercise a real user's access.
// A caller on the Internet can ask this route as often as it likes. The answer is therefore kept for a few seconds and shared, so the database is asked at
// most once per interval whatever the number of callers (VAPT-066 / VA-API-14). The reply carries no version or detail beyond what monitoring needs.
const CACHE_MS = 5000
let cached: { at: number; status: number; body: Record<string, unknown> } | null = null

export async function GET() {
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

    return { status: 200, body: { status: 'ok', db: 'ok', latency_ms: Date.now() - start, version: process.env.npm_package_version ?? '0.0.1' } }
  } catch (err) {
    console.error('[health] Unexpected error:', err)
    return { status: 503, body: { status: 'error', latency_ms: Date.now() - start } }
  }
}
