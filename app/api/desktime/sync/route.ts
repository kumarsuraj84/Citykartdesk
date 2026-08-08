import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runDeskTimeSync } from '@/lib/desktime/sync'

// Daily DeskTime pull for every connected org — see .claude/cron.md for the
// scheduling convention this mirrors (CRON_SECRET + x-cron-secret header,
// same as /api/alerts/run and /api/escalation/run).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  const secret = req.headers.get('x-cron-secret')
  if (secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: orgs } = await admin.from('organizations').select('id').not('desktime_credential_ref', 'is', null)

  const results: Record<string, unknown> = {}
  for (const org of orgs ?? []) {
    try {
      results[org.id] = await runDeskTimeSync(org.id, 3, 'cron')
    } catch (err) {
      results[org.id] = { error: err instanceof Error ? err.message : 'sync failed' }
    }
  }

  return NextResponse.json({ synced: (orgs ?? []).length, results })
}
