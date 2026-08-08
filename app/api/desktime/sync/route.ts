import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runDeskTimeSync } from '@/lib/desktime/sync'
import { verifyCronSecret } from '@/lib/cron-auth'

// Daily DeskTime pull for every connected org — see .claude/cron.md and
// docs/RAILWAY-DEPLOYMENT.md for the scheduling convention this mirrors
// (CRON_SECRET, checked via lib/cron-auth.ts — same as the other cron routes).
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (!verified) {
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
