import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runMastersSyncForOrg } from '@/lib/masters/run'

// Scheduled job (cron-tick job "pms-daily", every day at 09:00 India time): re-reads the sheets (read only towards Google) and, as the last step of that, makes the PMS tickets
// (the old AC PMS and every program's own PMS) whose PMS date is TODAY. A date that has already passed is never made automatically (a product rule: PMS_CATCH_UP_DAYS = 0);
// one that could not be made stays in the problem list for 7 days and the administrators are told once a day. The same step also runs after the 11:00, 15:00 and 19:00 copies
// of the sheets, so a date added during the day, or one that failed, is made at the next copy. A date never makes two tickets (lib/pms/tickets.ts).
// The tickets come from CK Desk's own copy of the dates, so an organisation whose Google connection is missing or broken still gets them; its sheets are simply not re-read.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  // the organisations whose AC PMS sheet is set up, and those with a switched-on Vendor Program that has its own PMS sheet (without this an org that only uses program PMS
  // would first get its tickets at the 11:00 copy, not at 09:00)
  const [{ data: srcs }, { data: progs }] = await Promise.all([
    admin.from('master_sources').select('org_id').eq('kind', 'pms'),
    admin.from('vendor_programs').select('org_id').eq('is_active', true).not('pms_spreadsheet_id', 'is', null),
  ])
  const orgs = [...new Set([...((srcs ?? []) as { org_id: string }[]), ...((progs ?? []) as { org_id: string }[])].map((s) => s.org_id))]
  const out: Record<string, unknown> = {}
  for (const orgId of orgs) {
    try {
      // no Google gate here: a missing connection only means the sheets are not re-read; the PMS tickets are still made from the database copy (lib/masters/run.ts)
      out[orgId] = await runMastersSyncForOrg(orgId)
    } catch (e) {
      console.error('[pms/daily] failed for org', orgId, e)
      out[orgId] = { error: 'failed' }
    }
  }
  return NextResponse.json({ orgs: out })
}
