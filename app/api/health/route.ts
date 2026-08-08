import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Uses the service-role client, not the anon-key createClient() the rest of the app
// uses — `anon` has no table grants at all (by design, RLS-only access), so an
// anon-scoped query here would always fail with "permission denied" and report
// this endpoint as unhealthy even when the app and DB are working correctly. This
// endpoint only needs to prove DB connectivity, not exercise a real user's access.
export async function GET() {
  const start = Date.now()

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('profiles').select('id').limit(1).maybeSingle()

    if (error) {
      console.error('[health] DB check failed:', error.message)
      return NextResponse.json(
        { status: 'degraded', db: 'error', latency_ms: Date.now() - start },
        { status: 503 }
      )
    }

    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      latency_ms: Date.now() - start,
      version: process.env.npm_package_version ?? '0.0.1',
    })
  } catch (err) {
    console.error('[health] Unexpected error:', err)
    return NextResponse.json(
      { status: 'error', latency_ms: Date.now() - start },
      { status: 503 }
    )
  }
}
