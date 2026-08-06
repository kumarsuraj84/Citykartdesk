'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { exportRequestsCSV, exportTasksCSV, exportApprovalsCSV } from '@/lib/export/reports'
import { sendEmail } from '@/lib/email/send'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager'].includes(profile.role)) return null
  return profile
}

export async function getScheduledReports(): Promise<{ data?: any[]; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin
    .from('scheduled_reports')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { data: data ?? [] }
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

  const admin = createAdminClient() as unknown as AnyClient
  const { data: row, error } = await admin
    .from('scheduled_reports')
    .insert({
      name: data.name.trim(),
      report_type: data.report_type,
      frequency: data.frequency,
      recipients: data.recipients,
      filters: data.filters,
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

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('scheduled_reports').update(data).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reports')
  return {}
}

export async function deleteScheduledReport(id: string): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('scheduled_reports').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reports')
  return {}
}

export async function sendScheduledReport(id: string): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: report, error: fetchErr } = await admin
    .from('scheduled_reports')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !report) return { error: fetchErr?.message ?? 'Report not found.' }

  let csv: string
  const filename = `${report.report_type}-report-${new Date().toISOString().slice(0, 10)}.csv`
  try {
    if (report.report_type === 'requests') {
      csv = await exportRequestsCSV(report.org_id, report.filters)
    } else if (report.report_type === 'tasks') {
      csv = await exportTasksCSV(report.org_id, report.filters)
    } else {
      csv = await exportApprovalsCSV(report.org_id, report.filters)
    }
  } catch (e: any) {
    return { error: e.message }
  }

  const attachment = {
    filename,
    content: Buffer.from(csv).toString('base64'),
  }

  const recipients: string[] = report.recipients ?? []
  for (const to of recipients) {
    const { error: emailErr } = await sendEmail({
      to,
      subject: `FlowDesk Report: ${report.name}`,
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
