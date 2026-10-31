import { exportRequestsCSV, exportTasksCSV, exportApprovalsCSV, type ExportFilters } from '@/lib/export/reports'
import { sendEmail } from '@/lib/email/send'
import { escapeHtml } from '@/lib/email/escape'
import { loadCcBook } from '@/lib/requests/cc-recipients'
import { checkReportRecipients } from '@/lib/reporting/report-recipients'
import { loadPolicies } from '@/lib/permissions/policies'

// Builds one scheduled report (a CSV) and mails it to its recipients. The ONE place that does it: the "Send now" button (lib/actions/admin/reports.ts) and the automatic run
// (lib/reports/run-due.ts) both call it, so a report looks and goes out the same way whichever started it.

export type ScheduledReportToSend = {
  id: string
  org_id: string
  name: string
  report_type: string
  frequency: string
  recipients: string[] | null
  filters: unknown
}

/** The recipients a report may be sent to: people of the organisation, and (unless the policy says users only) the known OEM / vendor contacts. */
export async function checkRecipients(orgId: string, raw: unknown) {
  const book = await loadCcBook(orgId)
  const oemAllowed = (await loadPolicies()).report_recipients !== 'users_only'
  return checkReportRecipients(raw, (email) => { const c = book.get(email); return !!c && (c.kind === 'user' || oemAllowed) })
}

/** `sent` = the people who got it (even when a later one failed); `error` = what went wrong (the first failure stops the sending, as the button always did). */
export async function deliverScheduledReport(report: ScheduledReportToSend): Promise<{ sent: string[]; error?: string }> {
  const orgId = report.org_id
  // `filters` is stored as arbitrary Json; the export functions only read the known ExportFilters keys, so this narrow-cast is safe.
  const filters = report.filters as unknown as ExportFilters | undefined
  const filename = `${report.report_type}-report-${new Date().toISOString().slice(0, 10)}.csv`
  let csv: string
  try {
    if (report.report_type === 'requests') csv = await exportRequestsCSV(orgId, filters)
    else if (report.report_type === 'tasks') csv = await exportTasksCSV(orgId, filters)
    else csv = await exportApprovalsCSV(orgId, filters)
  } catch (e) {
    return { sent: [], error: e instanceof Error ? e.message : String(e) }
  }
  const attachment = { filename, content: Buffer.from(csv).toString('base64') }

  // the stored list is checked again at send time, so an address saved before this rule existed is not used
  const checked = await checkRecipients(orgId, report.recipients ?? [])
  if (!checked.ok) return { sent: [], error: checked.error }
  const sent: string[] = []
  for (const to of checked.recipients) {
    const { error: emailErr } = await sendEmail({
      to,
      subject: `Citykart Desk Report: ${report.name}`,
      html: `<p>Please find attached the scheduled report <strong>${escapeHtml(report.name)}</strong> (${report.frequency}).</p>`,
      text: `Scheduled report: ${report.name} (${report.frequency}). See attached CSV.`,
      attachments: [attachment],
    })
    if (emailErr) return { sent, error: `Failed to send to ${to}: ${emailErr}` }
    sent.push(to)
  }
  return { sent }
}
