import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runMastersSyncForOrg } from '@/lib/masters/run'
import { demoSheetsDir } from '@/lib/masters/demo'

// Scheduled job (every minute): copies the AC, Genset, CVM and AC PMS Google Sheets into CK Desk (and makes the AC PMS tickets that are due). Read only towards Google.
// GET /api/masters/sync            normal check
// GET /api/masters/sync?force=1    read and apply every sheet even when nothing changed
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: conns } = demoSheetsDir()
    ? await admin.from('master_sources').select('org_id')
    : await admin.from('master_google_connection').select('org_id').eq('status', 'connected')
  const out: Record<string, unknown> = {}
  for (const c of [...new Map(((conns ?? []) as { org_id: string }[]).map((x) => [x.org_id, x])).values()]) {
    try {
      out[c.org_id] = await runMastersSyncForOrg(c.org_id, { force })
    } catch (e) {
      console.error('[masters/sync] failed for org', c.org_id, e)
      out[c.org_id] = { error: 'failed' }
    }
  }
  return NextResponse.json({ orgs: out })
}
