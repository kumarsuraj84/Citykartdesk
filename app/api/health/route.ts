import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const start = Date.now()

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('profiles').select('id').limit(1).maybeSingle()

    if (error) {
      return NextResponse.json(
        { status: 'degraded', db: 'error', message: error.message, latency_ms: Date.now() - start },
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
    return NextResponse.json(
      { status: 'error', message: String(err), latency_ms: Date.now() - start },
      { status: 503 }
    )
  }
}
