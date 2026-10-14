import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { recordAudit } from '@/lib/syslog/audit'
import { readLogRetention } from '@/lib/syslog/retention'

// Scheduled job (cron-tick job "system-log-archive"): moves old rows out of the System Log into its archive. Errors and events after the number of days set in
// Platform Settings > Retention (180 unless changed), audit and security rows after 7 years (SYSTEM_LOG_AUDIT_YEARS). Rows are MOVED, never dropped.

export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const years = Math.max(1, Number.parseInt(process.env.SYSTEM_LOG_AUDIT_YEARS ?? '', 10) || 7)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const days = (await readLogRetention(admin)).system_log
  const { data, error } = await admin.rpc('system_log_archive_old', { p_error_days: days, p_audit_years: years })
  if (error) {
    console.error('[system-log/archive] failed', error.message)
    return NextResponse.json({ ok: false, error: 'archive failed' }, { status: 500 })
  }
  const moved = Number(data ?? 0)
  if (moved > 0) await recordAudit({ action: 'system_log.archived', source: 'cron', entityType: 'system_log', message: `${moved} old rows moved to the archive`, detail: { moved, errorDays: days, auditYears: years } })
  return NextResponse.json({ ok: true, moved, errorDays: days, auditYears: years })
}
