'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'

type AnyClient = { from: (t: string) => any }
type ActionResult<T = undefined> = { error?: string; data?: T }

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'manager'].includes(profile.role)) return { error: 'Admin or manager role required.' }
  return { profile }
}

// ── Departments ───────────────────────────────────────────────────────────────

export async function createDepartment(fields: {
  name: string
  code?: string
  parent_id?: string | null
  head_user_id?: string | null
  is_active?: boolean
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.name.trim()) return { error: 'Department name is required.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin
    .from('departments')
    .insert({
      org_id: guard.profile!.org_id,
      name: fields.name.trim(),
      code: fields.code?.trim() || null,
      parent_id: fields.parent_id || null,
      head_user_id: fields.head_user_id || null,
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  revalidatePath('/admin/departments')
  return { data }
}

export async function updateDepartment(
  id: string,
  fields: {
    name?: string
    code?: string | null
    parent_id?: string | null
    head_user_id?: string | null
    is_active?: boolean
  }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient
  const update: Record<string, unknown> = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if ('parent_id' in fields) update.parent_id = fields.parent_id || null
  if ('head_user_id' in fields) update.head_user_id = fields.head_user_id || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('departments').update(update).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteDepartment(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('departments').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

// ── Locations ─────────────────────────────────────────────────────────────────

export async function createLocation(fields: {
  name: string
  code?: string
  city?: string
  country?: string
  timezone?: string
  is_active?: boolean
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.name.trim()) return { error: 'Location name is required.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin
    .from('locations')
    .insert({
      org_id: guard.profile!.org_id,
      name: fields.name.trim(),
      code: fields.code?.trim() || null,
      city: fields.city?.trim() || null,
      country: fields.country?.trim() || null,
      timezone: fields.timezone || 'UTC',
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  revalidatePath('/admin/locations')
  return { data }
}

export async function updateLocation(
  id: string,
  fields: {
    name?: string
    code?: string | null
    city?: string | null
    country?: string | null
    timezone?: string
    is_active?: boolean
  }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient
  const update: Record<string, unknown> = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if ('city' in fields) update.city = fields.city?.trim() || null
  if ('country' in fields) update.country = fields.country?.trim() || null
  if (fields.timezone !== undefined) update.timezone = fields.timezone
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('locations').update(update).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteLocation(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('locations').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

// ── Cost Centers ──────────────────────────────────────────────────────────────

export async function createCostCenter(fields: {
  name: string
  code?: string
  department_id?: string | null
  is_active?: boolean
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.name.trim()) return { error: 'Cost center name is required.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin
    .from('cost_centers')
    .insert({
      org_id: guard.profile!.org_id,
      name: fields.name.trim(),
      code: fields.code?.trim() || null,
      department_id: fields.department_id || null,
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return { data }
}

export async function updateCostCenter(
  id: string,
  fields: {
    name?: string
    code?: string | null
    department_id?: string | null
    is_active?: boolean
  }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient
  const update: Record<string, unknown> = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if ('department_id' in fields) update.department_id = fields.department_id || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('cost_centers').update(update).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteCostCenter(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('cost_centers').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

// ── User Org Fields ───────────────────────────────────────────────────────────

export async function updateUserOrgFields(
  userId: string,
  fields: {
    department_id?: string | null
    location_id?: string | null
    cost_center_id?: string | null
    employee_id?: string | null
    job_title?: string | null
    manager_id?: string | null
  }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('department_id' in fields) update.department_id = fields.department_id || null
  if ('location_id' in fields) update.location_id = fields.location_id || null
  if ('cost_center_id' in fields) update.cost_center_id = fields.cost_center_id || null
  if ('employee_id' in fields) update.employee_id = fields.employee_id?.trim() || null
  if ('job_title' in fields) update.job_title = fields.job_title?.trim() || null
  if ('manager_id' in fields) update.manager_id = fields.manager_id || null

  const { error } = await admin.from('profiles').update(update).eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/users')
  revalidatePath('/admin/org')
  return {}
}
