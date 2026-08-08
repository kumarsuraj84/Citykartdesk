'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { exportRequestsCSV, exportTasksCSV, exportApprovalsCSV, type ExportFilters } from '@/lib/export/reports'
import { sendEmail } from '@/lib/email/send'
import type { Database, Json } from '@/types/database'

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

export async function getScheduledReports(): Promise<{ data?: ScheduledReport[]; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scheduled_reports')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
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
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('scheduled_reports')
    .insert({
      name: data.name.trim(),
      report_type: data.report_type,
      frequency: data.frequency,
      recipients: data.recipients,
      filters: data.filters as unknown as Json,
      is_active: data.is_active,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !row) return { error: error?.message ?? 'Failed to create report.' }
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
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient()
  const update: Database['public']['Tables']['scheduled_reports']['Update'] = {
    ...data,
    filters: data.filters !== undefined ? (data.filters as unknown as Json) : undefined,
  }
  const { error } = await admin.from('scheduled_reports').update(update).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reports')
  return {}
}

export async function deleteScheduledReport(id: string): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient()
  const { error } = await admin.from('scheduled_reports').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reports')
  return {}
}

export async function sendScheduledReport(id: string): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient()
  const { data: report, error: fetchErr } = await admin
    .from('scheduled_reports')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !report) return { error: fetchErr?.message ?? 'Report not found.' }
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

  const recipients: string[] = report.recipients ?? []
  for (const to of recipients) {
    const { error: emailErr } = await sendEmail({
      to,
      subject: `Citykart Desk Report: ${report.name}`,
      html: `<p>Please find attached the scheduled report <strong>${report.name}</strong> (${report.frequency}).</p>`,
      text: `Scheduled report: ${report.name} (${report.frequency}). See attached CSV.`,
      attachments: [attachment],
    })
    if (emailErr) return { error: `Failed to send to ${to}: ${emailErr}` }
  }

  await admin
    .from('scheduled_reports')
    .update({ last_sent_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath('/admin/reports')
  return {}
}
