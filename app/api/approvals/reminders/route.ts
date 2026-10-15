import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendApprovalReminders } from '@/lib/approvals/reminders'
import { recordAudit } from '@/lib/syslog/audit'

// Scheduled job (cron-tick job "approval-reminders", every day at 10:00): one e-mail to each approver listing everything still waiting for their decision.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await sendApprovalReminders(createAdminClient() as any)
    if (result.sent > 0 || result.failed > 0) {
      await recordAudit({ action: 'approval.reminders_sent', source: 'cron', entityType: 'approval', message: `${result.sent} approval reminder e-mail(s) sent, ${result.failed} failed`, detail: { ...result } })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[approvals/reminders] failed', e)
    return NextResponse.json({ ok: false, error: 'approval reminders failed' }, { status: 500 })
  }
}
