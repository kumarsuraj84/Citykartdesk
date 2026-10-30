import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runMastersSyncForOrg } from '@/lib/masters/run'
import { demoSheetsDir } from '@/lib/masters/demo'

// Scheduled job (three times a day, 11:00 / 15:00 / 19:00, see scripts/windows/install-cron-tasks.ps1): copies the AC, Genset, CVM and AC PMS Google Sheets into CK Desk (and makes the AC PMS tickets that are due). Read only towards Google.
// GET /api/masters/sync            normal check
// GET /api/masters/sync?force=1    read and apply every sheet even when nothing changed
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  // every organisation that has a connected Google account, or any sheet set up, or a switched-on program with a PMS sheet: the last two still need their PMS tickets made
  // even when the connection is gone (runMastersSyncForOrg then skips the sheet copy and makes the tickets)
  const [conns, sources, progs] = await Promise.all([
    demoSheetsDir() ? Promise.resolve({ data: [] }) : admin.from('master_google_connection').select('org_id').eq('status', 'connected'),
    admin.from('master_sources').select('org_id'),
    admin.from('vendor_programs').select('org_id').eq('is_active', true).not('pms_spreadsheet_id', 'is', null),
  ])
  const orgIds = [...new Set([conns, sources, progs].flatMap((r) => ((r.data ?? []) as { org_id: string }[]).map((x) => x.org_id)))]
  const out: Record<string, unknown> = {}
  for (const c of orgIds.map((org_id) => ({ org_id }))) {
    try {
      out[c.org_id] = await runMastersSyncForOrg(c.org_id, { force })
    } catch (e) {
      console.error('[masters/sync] failed for org', c.org_id, e)
      out[c.org_id] = { error: 'failed' }
    }
  }
  return NextResponse.json({ orgs: out })
}
