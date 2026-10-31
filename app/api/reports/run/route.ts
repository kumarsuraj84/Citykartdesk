import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runDueScheduledReports } from '@/lib/reports/run-due'

// Scheduled job (cron-tick job "scheduled-reports", every 30 minutes): sends the scheduled reports (Admin > Reports > Scheduled reports) that are due. Daily reports go out at 07:00
// India time, weekly ones on Monday at 07:00 and monthly ones on the 1st at 07:00 (lib/reports/schedule.ts). A report is claimed before it is sent, so two runs never send it twice.
// The answer says `ok: false` with an `error` when a report could not be sent, so the runner (scripts/cron-tick.mjs) shows the task as failed and the System Log records it.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const r = await runDueScheduledReports(admin)
    if (r.failed.length > 0) return NextResponse.json({ ok: false, error: `${r.failed.length} scheduled report(s) could not be sent`, ...r })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[reports/run] failed', e)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
