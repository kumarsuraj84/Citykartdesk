import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runVisitAutomation } from '@/lib/visits/auto'

// Scheduled job (every 15 minutes): resolves an engineer's "resolved" that the store did not answer in time, and sends the store's reminder.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runVisitAutomation(createAdminClient()))
  } catch (e) {
    console.error('[visits/run] failed', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
