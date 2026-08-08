'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return null
  return profile
}

export async function createAssignmentRule(data: {
  name: string
  scope_type: 'service' | 'sub_category' | 'category'
  scope_id: string
  strategy: 'direct' | 'round_robin' | 'load_balanced'
  assignee_ids: string[]
  priority_filter: string | null
  is_active: boolean
}): Promise<{ id?: string; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: rule, error } = await admin
    .from('assignment_rules')
    .insert({
      name: data.name.trim(),
      scope_type: data.scope_type,
      scope_id: data.scope_id,
      strategy: data.strategy,
      assignee_ids: data.assignee_ids,
      priority_filter: data.priority_filter || null,
      is_active: data.is_active,
      last_assigned_index: 0,
    })
    .select('id')
    .single()

  if (error || !rule) return { error: error?.message ?? 'Failed to create rule.' }
  revalidatePath('/admin/routing')
  return { id: rule.id }
}

export async function updateAssignmentRule(
  id: string,
  data: Partial<{
    name: string
    scope_type: string
    scope_id: string
    strategy: string
    assignee_ids: string[]
    priority_filter: string | null
    is_active: boolean
  }>
): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const payload: Record<string, unknown> = {}
  if (data.name !== undefined) payload.name = data.name.trim()
  if (data.scope_type !== undefined) payload.scope_type = data.scope_type
  if (data.scope_id !== undefined) payload.scope_id = data.scope_id
  if (data.strategy !== undefined) payload.strategy = data.strategy
  if (data.assignee_ids !== undefined) payload.assignee_ids = data.assignee_ids
  if ('priority_filter' in data) payload.priority_filter = data.priority_filter || null
  if (data.is_active !== undefined) payload.is_active = data.is_active

  const { error } = await admin.from('assignment_rules').update(payload).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/routing')
  return {}
}

export async function deleteAssignmentRule(id: string): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('assignment_rules').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/routing')
  return {}
}

export async function toggleRuleActive(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('assignment_rules')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/routing')
  return {}
}
