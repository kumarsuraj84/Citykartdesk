import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runMastersSyncForOrg } from '@/lib/masters/run'
import { demoSheetsDir } from '@/lib/masters/demo'

// Scheduled job (cron-tick job "pms-daily", every day at 09:00 India time): re-reads the sheets (read only towards Google) and, as the last step of that, makes the AC PMS
// tickets whose PMS date is today (and any date of the last two days that was missed). The same step also runs after the 11:00, 15:00 and 19:00 copies of the sheets, so a
// date added during the day is made at the next copy. A date never makes two tickets (lib/pms/tickets.ts).
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  // only the organisations whose AC PMS sheet is set up
  const { data: srcs } = await admin.from('master_sources').select('org_id').eq('kind', 'pms')
  const orgs = [...new Set(((srcs ?? []) as { org_id: string }[]).map((s) => s.org_id))]
  const out: Record<string, unknown> = {}
  for (const orgId of orgs) {
    try {
      if (!demoSheetsDir()) {
        const { data: conn } = await admin.from('master_google_connection').select('status').eq('org_id', orgId).maybeSingle()
        if (conn?.status !== 'connected') { out[orgId] = { skipped: 'Google Sheets is not connected' }; continue }
      }
      out[orgId] = await runMastersSyncForOrg(orgId)
    } catch (e) {
      console.error('[pms/daily] failed for org', orgId, e)
      out[orgId] = { error: 'failed' }
    }
  }
  return NextResponse.json({ orgs: out })
}
