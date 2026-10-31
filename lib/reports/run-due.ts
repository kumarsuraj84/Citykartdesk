import { logger } from '@/lib/observability/logger'
import { deliverScheduledReport } from './deliver'
import { isReportDue, latestSlot, RETRY_WINDOW_MS, type ReportFrequency } from './schedule'

// The automatic sender of the scheduled reports (cron job "scheduled-reports", every 30 minutes; the rule of WHEN a report is due is lib/reports/schedule.ts).
//  - A report is CLAIMED before it is sent (its last_sent_at is moved to now with a condition on the old value), so two runs that overlap can never send the same report twice.
//  - A report that could not be sent to ANYBODY gets its old last_sent_at back, so the next run (30 minutes later) tries again; it is tried again for 6 hours after its slot, then it
//    waits for the next one. A report that reached some people and failed for another is NOT sent again (the first ones would get it twice): the failure is logged.
//  - A report with no recipients is skipped (nothing to send), and the administrator sees it on the screen ("no recipients").
// Uses the server's client: a system action with no interactive person.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

type ReportRow = {
  id: string; org_id: string; name: string; report_type: string; frequency: ReportFrequency
  recipients: string[] | null; filters: unknown; is_active: boolean; last_sent_at: string | null; created_at: string | null
}

export type RunDueResult = { checked: number; due: number; sent: number; skipped: number; failed: { id: string; name: string; error: string }[] }

export async function runDueScheduledReports(db: Db, now: Date = new Date()): Promise<RunDueResult> {
  const out: RunDueResult = { checked: 0, due: 0, sent: 0, skipped: 0, failed: [] }
  const { data, error } = await db.from('scheduled_reports').select('id, org_id, name, report_type, frequency, recipients, filters, is_active, last_sent_at, created_at').eq('is_active', true)
  // an unreadable list must not look like "nothing is due"
  if (error) throw new Error(`Could not read the scheduled reports: ${error.message ?? 'unknown error'}`)
  const reports = (data ?? []) as ReportRow[]
  out.checked = reports.length

  for (const r of reports) {
    if (!isReportDue(r, now)) continue
    out.due++
    const slot = latestSlot(r.frequency, now)
    if (!(r.recipients ?? []).length) { out.skipped++; continue }

    // claim: only the run that moves last_sent_at from the value it read wins
    let claim = db.from('scheduled_reports').update({ last_sent_at: now.toISOString() }).eq('id', r.id).eq('is_active', true)
    claim = r.last_sent_at === null ? claim.is('last_sent_at', null) : claim.eq('last_sent_at', r.last_sent_at)
    const { data: won, error: claimErr } = await claim.select('id')
    if (claimErr) { out.failed.push({ id: r.id, name: r.name, error: `could not claim the report: ${claimErr.message ?? 'database error'}` }); continue }
    if (!won || won.length === 0) continue   // another run has it

    let delivered: { sent: string[]; error?: string }
    try {
      delivered = await deliverScheduledReport(r)
    } catch (e) {
      delivered = { sent: [], error: e instanceof Error ? e.message : String(e) }
    }
    if (!delivered.error) { out.sent++; continue }

    out.failed.push({ id: r.id, name: r.name, error: delivered.error })
    logger.error({ event: 'scheduled_report.failed', message: `The scheduled report "${r.name}" could not be sent: ${delivered.error}`, route: 'lib/reports/run-due.ts', orgId: r.org_id, context: { reportId: r.id, sentTo: delivered.sent.length } })
    if (delivered.sent.length === 0) {
      // nobody got it: give the old time back so the next run tries again (only while the slot is still recent; after that it waits for the next slot)
      const recent = now.getTime() - slot.getTime() <= RETRY_WINDOW_MS
      if (recent) await db.from('scheduled_reports').update({ last_sent_at: r.last_sent_at }).eq('id', r.id)
    }
  }
  return out
}
