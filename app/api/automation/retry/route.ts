import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runAutomationRetry } from '@/lib/automation/rerun'
import type { Db } from '@/lib/automation/diagnose'

// Scheduled job (cron-tick job "automation-retry", every 15 minutes): finds tickets made since the "automation state" exists (newer than 3 days, older than 10 minutes) where an
// automatic step did not happen - the mail to the OEM / vendor failed or the sheet was not ready, the Business Rules were interrupted by a restart, the CVM approval was not
// sent - and does ONLY those steps again (lib/automation/rerun.ts). At most 3 tries per ticket; then it stops, leaves a note on the ticket and the ticket stays in
// Admin > Stuck tickets. A step that already worked is never repeated.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await runAutomationRetry(createAdminClient() as unknown as Db)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[automation/retry] failed', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
