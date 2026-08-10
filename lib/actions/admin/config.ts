'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// ── App settings ──────────────────────────────────────────────────────────────

export async function updateAppSetting(
  key: string,
  value: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  // app_settings is a plain key/value table (key TEXT PRIMARY KEY, value TEXT) with
  // no updated_at column — don't include one in the upsert payload.
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' })

  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

// ── Task templates ────────────────────────────────────────────────────────────

export async function createTaskTemplate(data: {
  name: string
  description?: string
  teamId?: string
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: tmpl, error } = await admin
    .from('task_templates')
    .insert({
      org_id: profile.org_id,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      team_id: data.teamId || null,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !tmpl) return { error: error?.message ?? 'Failed to create template.' }
  revalidatePath('/admin/task-config')
  return { data: { id: tmpl.id } }
}

export async function updateTaskTemplate(
  id: string,
  data: { name?: string; description?: string }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (data.name !== undefined) update.name = data.name.trim()
  if (data.description !== undefined) update.description = data.description.trim() || null

  const { error } = await admin.from('task_templates').update(update).eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/task-config')
  return {}
}

export async function deleteTaskTemplate(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('task_templates').delete().eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/task-config')
  return {}
}

export async function upsertTemplateItem(data: {
  templateId: string
  id?: string
  title: string
  description?: string
  defaultPriority?: 'low' | 'medium' | 'high' | 'urgent'
  dueOffsetDays?: number | null
  position?: number
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient

  // task_template_items has no org_id of its own — scope via its parent template.
  const { data: template } = await admin.from('task_templates').select('id').eq('id', data.templateId).eq('org_id', profile.org_id).maybeSingle()
  if (!template) return { error: 'Template not found.' }

  const payload = {
    template_id:      data.templateId,
    title:            data.title.trim(),
    description:      data.description?.trim() || null,
    default_priority: data.defaultPriority ?? 'medium',
    due_offset_days:  data.dueOffsetDays ?? null,
    position:         data.position ?? 0,
  }

  let result
  if (data.id) {
    // Also confirm the item being edited already belongs to an in-org template —
    // otherwise a caller who knows another org's item id could reassign it
    // (via the template_id in payload) into this org's template.
    const { data: existingItem } = await admin
      .from('task_template_items')
      .select('id, task_templates!inner(org_id)')
      .eq('id', data.id)
      .eq('task_templates.org_id', profile.org_id)
      .maybeSingle()
    if (!existingItem) return { error: 'Template item not found.' }
    result = await admin.from('task_template_items').update(payload).eq('id', data.id).select('id').single()
  } else {
    result = await admin.from('task_template_items').insert(payload).select('id').single()
  }

  if (result.error) return { error: result.error.message }
  revalidatePath('/admin/task-config')
  return { data: { id: result.data.id } }
}

export async function deleteTemplateItem(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: existingItem } = await admin
    .from('task_template_items')
    .select('id, task_templates!inner(org_id)')
    .eq('id', id)
    .eq('task_templates.org_id', profile.org_id)
    .maybeSingle()
  if (!existingItem) return { error: 'Template item not found.' }

  const { error } = await admin.from('task_template_items').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/task-config')
  return {}
}

// ── Business Hours ────────────────────────────────────────────────────────────

export async function updateBusinessHours(
  dayOfWeek: number,
  data: { start_time: string; end_time: string; is_active: boolean }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('business_hours')
    .update({ start_time: data.start_time, end_time: data.end_time, is_active: data.is_active })
    .eq('day_of_week', dayOfWeek)

  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

// ── Holidays ──────────────────────────────────────────────────────────────────

export async function createHoliday(data: {
  name: string
  date: string
  is_recurring: boolean
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('holidays').insert({
    name: data.name.trim(),
    date: data.date,
    is_recurring: data.is_recurring,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

export async function deleteHoliday(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('holidays').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

// ── Alert Rules ───────────────────────────────────────────────────────────────

export type AlertRuleData = {
  name: string
  alert_type: 'due_soon' | 'overdue' | 'unassigned' | 'sla_warning' | 'sla_breached' | 'daily_digest'
  entity_type: 'request' | 'task' | 'milestone'
  threshold_minutes?: number | null
  notify_roles: string[]
  notify_assignee: boolean
  notify_requester: boolean
  channels: string[]
  is_active?: boolean
}

export async function createAlertRule(data: AlertRuleData): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('alert_rules').insert({
    org_id: profile.org_id,
    name: data.name.trim(),
    alert_type: data.alert_type,
    entity_type: data.entity_type,
    threshold_minutes: data.threshold_minutes ?? null,
    notify_roles: data.notify_roles,
    notify_assignee: data.notify_assignee,
    notify_requester: data.notify_requester,
    channels: data.channels,
    is_active: data.is_active ?? true,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

export async function updateAlertRule(
  id: string,
  data: Partial<AlertRuleData>
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('alert_rules').update(data).eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

export async function deleteAlertRule(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('alert_rules').delete().eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

export async function toggleAlertRule(id: string, is_active: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('alert_rules').update({ is_active }).eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}

// MASTER_DATA_ROUTE: /admin/master-data

// ── Tags ──────────────────────────────────────────────────────────────────────

export async function createTag(data: { name: string; color: string }): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('tags').insert({ org_id: profile.org_id, name: data.name.trim(), color: data.color })
  if (error) return { error: error.message }
  revalidatePath('/admin/master-data')
  return {}
}

export async function updateTag(
  id: string,
  data: Partial<{ name: string; color: string; is_active: boolean }>
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('tags').update(data).eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/master-data')
  return {}
}

export async function deleteTag(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('tags').delete().eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/master-data')
  return {}
}

// ── Request Priorities ────────────────────────────────────────────────────────

export async function updateRequestPriority(
  id: string,
  data: Partial<{ name: string; color: string; sla_multiplier: number; is_active: boolean; display_order: number }>
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('request_priorities').update(data).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/master-data')
  return {}
}

// ── Data Retention Policies ───────────────────────────────────────────────────

export async function updateRetentionPolicy(
  id: string,
  data: { retention_days: number; archive_after_days?: number | null; purge_after_days?: number | null }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin','platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('retention_policies')
    .update({
      retention_days:     data.retention_days,
      archive_after_days: data.archive_after_days ?? null,
      purge_after_days:   data.purge_after_days ?? null,
      updated_at:         new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/admin/settings')
  return {}
}
