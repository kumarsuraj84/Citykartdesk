'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { exportRequestsCSV, exportTasksCSV, exportApprovalsCSV, type ExportFilters } from '@/lib/export/reports'
import { sendEmail } from '@/lib/email/send'
import { recordAudit } from '@/lib/syslog/audit'
import { escapeHtml } from '@/lib/email/escape'
import { loadCcBook } from '@/lib/requests/cc-recipients'
import { checkReportRecipients } from '@/lib/reporting/report-recipients'
import type { Database, Json } from '@/types/database'
import { sanitizeError } from '@/lib/observability/sanitize-error'

type ScheduledReportRow = Database['public']['Tables']['scheduled_reports']['Row']

// The `filters` column is stored as arbitrary Json and `created_at` is
// nullable at the DB level, but every call site (ScheduledReportsClient's
// ScheduledReport type) treats them as a plain object and a definite string
// respectively — normalize both on the way out.
export type ScheduledReport = Omit<ScheduledReportRow, 'filters' | 'created_at'> & {
  filters: Record<string, unknown>
  created_at: string
}

function normalizeFilters(row: ScheduledReportRow): ScheduledReport {
  const filters = row.filters && typeof row.filters === 'object' && !Array.isArray(row.filters)
    ? (row.filters as Record<string, unknown>)
    : {}
  return { ...row, filters, created_at: row.created_at ?? new Date().toISOString() }
}

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return null
  return profile
}

// D-012: a scheduled report carries the whole organization's tickets / tasks / approvals, which is more than a manager is allowed to see
// on the other report screens (those are limited to the manager's own groups). Creating, changing, deleting and sending one is therefore
// for administrators; managers can still look at the list.
async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) return null
  return profile
}

const REPORT_TYPES = ['requests', 'tasks', 'approvals'] as const
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const

async function checkRecipients(orgId: string, raw: unknown) {
  const book = await loadCcBook(orgId)
  return checkReportRecipients(raw, (email) => book.has(email))
}

export async function getScheduledReports(): Promise<{ data?: ScheduledReport[]; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scheduled_reports')
    .select('*')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/reports.ts' }) }
  return { data: (data ?? []).map(normalizeFilters) }
}

export async function createScheduledReport(data: {
  name: string
  report_type: 'requests' | 'tasks' | 'approvals'
  frequency: 'daily' | 'weekly' | 'monthly'
  recipients: string[]
  filters: Record<string, unknown>
  is_active: boolean
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!REPORT_TYPES.includes(data.report_type)) return { error: 'Unknown report type.' }
  if (!FREQUENCIES.includes(data.frequency)) return { error: 'Unknown frequency.' }
  if (!data.name?.trim()) return { error: 'A report needs a name.' }
  const recipients = await checkRecipients(profile.org_id, data.recipients)
  if (!recipients.ok) return { error: recipients.error }

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('scheduled_reports')
    .insert({
      org_id: profile.org_id,
      name: data.name.trim(),
      report_type: data.report_type,
      frequency: data.frequency,
      recipients: recipients.recipients,
      filters: data.filters as unknown as Json,
      is_active: data.is_active,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !row) return { error: error?.message ?? 'Failed to create report.' }
  await recordAudit({ category: 'security', action: 'scheduled_report.created', entityType: 'scheduled_report', entityId: row.id, entityLabel: data.name.trim(), after: { report_type: data.report_type, frequency: data.frequency, recipients: recipients.recipients, is_active: data.is_active }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/reports')
  return { data: { id: row.id } }
}

export async function updateScheduledReport(
  id: string,
  data: Partial<{
    name: string
    report_type: 'requests' | 'tasks' | 'approvals'
    frequency: 'daily' | 'weekly' | 'monthly'
    recipients: string[]
    filters: Record<string, unknown>
    is_active: boolean
  }>
): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  // D-013: only these fields can ever be changed; anything else in the request (organization, creator, last-sent time...) is ignored
  const update: Database['public']['Tables']['scheduled_reports']['Update'] = {}
  if (data.name !== undefined) { if (!String(data.name).trim()) return { error: 'A report needs a name.' }; update.name = String(data.name).trim() }
  if (data.report_type !== undefined) { if (!REPORT_TYPES.includes(data.report_type)) return { error: 'Unknown report type.' }; update.report_type = data.report_type }
  if (data.frequency !== undefined) { if (!FREQUENCIES.includes(data.frequency)) return { error: 'Unknown frequency.' }; update.frequency = data.frequency }
  if (data.is_active !== undefined) update.is_active = Boolean(data.is_active)
  if (data.filters !== undefined) update.filters = data.filters as unknown as Json
  if (data.recipients !== undefined) {
    const recipients = await checkRecipients(profile.org_id, data.recipients)
    if (!recipients.ok) return { error: recipients.error }
    update.recipients = recipients.recipients
  }
  if (Object.keys(update).length === 0) return {}

  const admin = createAdminClient()
  const { error } = await admin.from('scheduled_reports').update(update).eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/reports.ts' }) }
  await recordAudit({ category: 'security', action: 'scheduled_report.updated', entityType: 'scheduled_report', entityId: id, after: update, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/reports')
  return {}
}

export async function deleteScheduledReport(id: string): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient()
  const { error } = await admin.from('scheduled_reports').delete().eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/reports.ts' }) }
  await recordAudit({ category: 'security', action: 'scheduled_report.deleted', entityType: 'scheduled_report', entityId: id, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/reports')
  return {}
}

export async function sendScheduledReport(id: string): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient()
  const { data: report, error: fetchErr } = await admin
    .from('scheduled_reports')
    .select('*')
    .eq('id', id)
    .eq('org_id', profile.org_id)
    .maybeSingle()

  if (fetchErr) return { error: sanitizeError(fetchErr, { route: 'lib/actions/admin/reports.ts' }) }
  if (!report) return { error: 'Report not found.' }
  if (!report.org_id) return { error: 'Report has no organization context.' }

  const orgId = report.org_id
  // `filters` is stored as arbitrary Json; the export functions only read the
  // known ExportFilters keys, so this narrow-cast is safe.
  const filters = report.filters as unknown as ExportFilters | undefined

  let csv: string
  const filename = `${report.report_type}-report-${new Date().toISOString().slice(0, 10)}.csv`
  try {
    if (report.report_type === 'requests') {
      csv = await exportRequestsCSV(orgId, filters)
    } else if (report.report_type === 'tasks') {
      csv = await exportTasksCSV(orgId, filters)
    } else {
      csv = await exportApprovalsCSV(orgId, filters)
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }

  const attachment = {
    filename,
    content: Buffer.from(csv).toString('base64'),
  }

  // the stored list is checked again at send time, so an address saved before this rule existed is not used
  const checked = await checkRecipients(orgId, report.recipients ?? [])
  if (!checked.ok) return { error: checked.error }
  const recipients: string[] = checked.recipients
  for (const to of recipients) {
    const { error: emailErr } = await sendEmail({
      to,
      subject: `Citykart Desk Report: ${report.name}`,
      html: `<p>Please find attached the scheduled report <strong>${escapeHtml(report.name)}</strong> (${report.frequency}).</p>`,
      text: `Scheduled report: ${report.name} (${report.frequency}). See attached CSV.`,
      attachments: [attachment],
    })
    if (emailErr) return { error: `Failed to send to ${to}: ${emailErr}` }
  }

  await admin
    .from('scheduled_reports')
    .update({ last_sent_at: new Date().toISOString() })
    .eq('id', id)

  await recordAudit({ category: 'security', action: 'scheduled_report.sent', entityType: 'scheduled_report', entityId: id, entityLabel: report.name, after: { recipients, report_type: report.report_type }, actorId: profile.id, orgId: profile.org_id })
  revalidatePath('/admin/reports')
  return {}
}
