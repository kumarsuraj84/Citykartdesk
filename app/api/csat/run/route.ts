import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { autoCloseDueRequests } from '@/lib/requests/auto-close'
import { sendDueCsatReminders } from '@/lib/csat/reminders'

// Scheduled job: close resolved tickets whose reopen window has passed (bell only), and send the one CSAT reminder.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  let autoClosed = 0
  let reminders = 0
  try {
    autoClosed = await autoCloseDueRequests(admin, null, 200)
  } catch (e) {
    console.error('[csat/run] auto-close failed', e)
  }
  try {
    reminders = await sendDueCsatReminders(admin as never, 100)
  } catch (e) {
    console.error('[csat/run] reminders failed', e)
  }
  return NextResponse.json({ autoClosed, reminders })
}
