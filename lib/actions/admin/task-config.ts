'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return null
  return profile
}

// ── Task Statuses ─────────────────────────────────────────────────────────────

export async function createTaskStatus(data: {
  name: string
  value: string
  color: string
  display_order: number
  is_terminal: boolean
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: row, error } = await admin
    .from('task_statuses')
    .insert({
      name: data.name.trim(),
      value: data.value.trim().toLowerCase().replace(/\s+/g, '_'),
      color: data.color,
      display_order: data.display_order,
      is_terminal: data.is_terminal,
      is_active: true,
    })
    .select('id')
    .single()

  if (error || !row) return { error: error?.message ?? 'Failed to create status.' }
  revalidatePath('/admin/task-config')
  return { data: { id: row.id } }
}

export async function updateTaskStatus(
  id: string,
  data: Partial<{
    name: string
    value: string
    color: string
    display_order: number
    is_terminal: boolean
    is_active: boolean
  }>
): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const payload: Record<string, unknown> = { ...data }
  if (data.name) payload.name = data.name.trim()
  if (data.value) payload.value = data.value.trim().toLowerCase().replace(/\s+/g, '_')

  const { error } = await admin.from('task_statuses').update(payload).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/task-config')
  return {}
}

export async function deleteTaskStatus(id: string): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('task_statuses').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/task-config')
  return {}
}

export async function reorderTaskStatuses(orderedIds: string[]): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const updates = orderedIds.map((id, index) =>
    admin.from('task_statuses').update({ display_order: index }).eq('id', id)
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed?.error) return { error: failed.error.message }
  revalidatePath('/admin/task-config')
  return {}
}

// ── Task Priorities ───────────────────────────────────────────────────────────

export async function createTaskPriority(data: {
  name: string
  value: string
  color: string
  display_order: number
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: row, error } = await admin
    .from('task_priorities')
    .insert({
      name: data.name.trim(),
      value: data.value.trim().toLowerCase().replace(/\s+/g, '_'),
      color: data.color,
      display_order: data.display_order,
      is_active: true,
    })
    .select('id')
    .single()

  if (error || !row) return { error: error?.message ?? 'Failed to create priority.' }
  revalidatePath('/admin/task-config')
  return { data: { id: row.id } }
}

export async function updateTaskPriority(
  id: string,
  data: Partial<{
    name: string
    value: string
    color: string
    display_order: number
    is_active: boolean
  }>
): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const payload: Record<string, unknown> = { ...data }
  if (data.name) payload.name = data.name.trim()
  if (data.value) payload.value = data.value.trim().toLowerCase().replace(/\s+/g, '_')

  const { error } = await admin.from('task_priorities').update(payload).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/task-config')
  return {}
}

export async function deleteTaskPriority(id: string): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('task_priorities').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/task-config')
  return {}
}
