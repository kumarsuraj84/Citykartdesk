'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { assertRefsInOrg } from './orgScopeGuard'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import type { Database } from '@/types/database'

type ActionResult<T = undefined> = { error?: string; data?: T }
type DepartmentUpdate = Database['public']['Tables']['departments']['Update']
type LocationUpdate = Database['public']['Tables']['locations']['Update']
type StoreUpdate = Database['public']['Tables']['stores']['Update']
type CostCenterUpdate = Database['public']['Tables']['cost_centers']['Update']
type JobFunctionUpdate = Database['public']['Tables']['job_functions']['Update']
type DesignationUpdate = Database['public']['Tables']['designations']['Update']
type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Admin or manager role required.' }
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

  const admin = createAdminClient()
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

  if (error) return { error: sanitizeError(error, { route: 'org.ts#createDepartment', fallback: 'Failed to create department.' }) }
  revalidatePath('/admin/org')
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

  const admin = createAdminClient()
  const update: DepartmentUpdate = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if ('parent_id' in fields) update.parent_id = fields.parent_id || null
  if ('head_user_id' in fields) update.head_user_id = fields.head_user_id || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('departments').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#updateDepartment', fallback: 'Failed to update department.' }) }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteDepartment(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('departments').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#deleteDepartment', fallback: 'Failed to delete department.' }) }
  revalidatePath('/admin/org')
  return {}
}

function isActiveValue(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === '') return true
  return ['true', 'yes', '1', 'active'].includes(raw.trim().toLowerCase())
}

// ── importDepartments ───────────────────────────────────────────────────────────
// Bulk-creates departments from parsed CSV rows. Supports a `parent_department`
// column referencing another row's name (in this file or already in the DB) —
// resolved in a second pass since a parent might be created earlier in the
// same import.

export async function importDepartments(
  rows: { name: string; code?: string; parent_department?: string; active?: string }[]
): Promise<ActionResult<{ imported: number; errors: string[] }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (rows.length === 0) return { error: 'No rows to import.' }

  const admin = createAdminClient()
  const orgId = guard.profile!.org_id
  if (!orgId) return { error: 'No organization context.' }

  const { data: existing } = await admin.from('departments').select('id, name').eq('org_id', orgId)
  const nameToId = new Map<string, string>(
    (existing ?? []).map((d) => [d.name.trim().toLowerCase(), d.id])
  )

  const errors: string[] = []
  const pendingParents: { id: string; parentName: string; rowLabel: string }[] = []
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const rowLabel = `Row ${i + 2}`
    const name = rows[i].name?.trim()
    if (!name) { errors.push(`${rowLabel}: name is required, skipped.`); continue }
    if (nameToId.has(name.toLowerCase())) { errors.push(`${rowLabel}: "${name}" already exists, skipped.`); continue }

    const { data, error } = await admin
      .from('departments')
      .insert({
        org_id: orgId,
        name,
        code: rows[i].code?.trim() || null,
        is_active: isActiveValue(rows[i].active),
      })
      .select('id')
      .single()

    if (error) { errors.push(`${rowLabel}: ${sanitizeError(error, { route: 'org.ts#importDepartments' })}`); continue }

    nameToId.set(name.toLowerCase(), data.id)
    imported++
    if (rows[i].parent_department?.trim()) {
      pendingParents.push({ id: data.id, parentName: rows[i].parent_department!.trim(), rowLabel })
    }
  }

  for (const p of pendingParents) {
    const parentId = nameToId.get(p.parentName.toLowerCase())
    if (!parentId) { errors.push(`${p.rowLabel}: parent department "${p.parentName}" not found, left unassigned.`); continue }
    await admin.from('departments').update({ parent_id: parentId }).eq('id', p.id)
  }

  revalidatePath('/admin/org')
  return { data: { imported, errors } }
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

  const admin = createAdminClient()
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

  if (error) return { error: sanitizeError(error, { route: 'org.ts#createLocation', fallback: 'Failed to create location.' }) }
  revalidatePath('/admin/org')
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

  const admin = createAdminClient()
  const update: LocationUpdate = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if ('city' in fields) update.city = fields.city?.trim() || null
  if ('country' in fields) update.country = fields.country?.trim() || null
  if (fields.timezone !== undefined) update.timezone = fields.timezone
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('locations').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#updateLocation', fallback: 'Failed to update location.' }) }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteLocation(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('locations').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#deleteLocation', fallback: 'Failed to delete location.' }) }
  revalidatePath('/admin/org')
  return {}
}

// ── importLocations ─────────────────────────────────────────────────────────────

export async function importLocations(
  rows: { name: string; code?: string; city?: string; country?: string; timezone?: string; active?: string }[]
): Promise<ActionResult<{ imported: number; errors: string[] }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (rows.length === 0) return { error: 'No rows to import.' }

  const admin = createAdminClient()
  const orgId = guard.profile!.org_id
  const errors: string[] = []
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const rowLabel = `Row ${i + 2}`
    const name = rows[i].name?.trim()
    if (!name) { errors.push(`${rowLabel}: name is required, skipped.`); continue }

    const { error } = await admin.from('locations').insert({
      org_id: orgId,
      name,
      code: rows[i].code?.trim() || null,
      city: rows[i].city?.trim() || null,
      country: rows[i].country?.trim() || null,
      timezone: rows[i].timezone?.trim() || 'UTC',
      is_active: isActiveValue(rows[i].active),
    })

    if (error) { errors.push(`${rowLabel}: ${sanitizeError(error, { route: 'org.ts#importLocations' })}`); continue }
    imported++
  }

  revalidatePath('/admin/org')
  return { data: { imported, errors } }
}

// ── Stores (Store Master) ────────────────────────────────────────────────────
// One physical store per row, distinct from the coarse `locations` category
// (HO/Stores/Warehouse) — this is what the "AC Issues Support" address
// auto-fill and OEM routing both key off. See lib/actions/requests.ts.

export async function createStore(fields: {
  code: string
  name: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  oem_id?: string | null
  is_active?: boolean
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.code.trim()) return { error: 'Store code is required.' }
  if (!fields.name.trim()) return { error: 'Store name is required.' }

  const admin = createAdminClient()

  // requireAdminOrManager() only proves the caller's ROLE — the admin client
  // bypasses RLS entirely, so without this check a caller could wire a store
  // to another org's OEM by id, and every ticket from that store would then
  // email that OTHER org's OEM with this org's ticket contents.
  if (fields.oem_id) {
    const { data: oem } = await admin.from('oems').select('id').eq('id', fields.oem_id).eq('org_id', guard.profile!.org_id!).maybeSingle()
    if (!oem) return { error: 'Selected OEM not found in your organisation.' }
  }

  const { data, error } = await admin
    .from('stores')
    .insert({
      org_id: guard.profile!.org_id!,
      code: fields.code.trim().toUpperCase(),
      name: fields.name.trim(),
      address: fields.address?.trim() || null,
      city: fields.city?.trim() || null,
      state: fields.state?.trim() || null,
      pincode: fields.pincode?.trim() || null,
      oem_id: fields.oem_id || null,
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error) {
    return { error: error.code === '23505' ? `A store with code "${fields.code.trim().toUpperCase()}" already exists.` : sanitizeError(error, { route: 'org.ts#createStore', fallback: 'Failed to create store.' }) }
  }
  revalidatePath('/admin/org')
  return { data }
}

export async function updateStore(
  id: string,
  fields: {
    code?: string
    name?: string
    address?: string | null
    city?: string | null
    state?: string | null
    pincode?: string | null
    oem_id?: string | null
    is_active?: boolean
  }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()

  // Same cross-tenant guard as createStore() — see its comment.
  if (fields.oem_id) {
    const { data: oem } = await admin.from('oems').select('id').eq('id', fields.oem_id).eq('org_id', guard.profile!.org_id!).maybeSingle()
    if (!oem) return { error: 'Selected OEM not found in your organisation.' }
  }

  const update: StoreUpdate = {}
  if (fields.code !== undefined) update.code = fields.code.trim().toUpperCase()
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('address' in fields) update.address = fields.address?.trim() || null
  if ('city' in fields) update.city = fields.city?.trim() || null
  if ('state' in fields) update.state = fields.state?.trim() || null
  if ('pincode' in fields) update.pincode = fields.pincode?.trim() || null
  if ('oem_id' in fields) update.oem_id = fields.oem_id || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('stores').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) {
    return { error: error.code === '23505' ? `A store with that code already exists.` : sanitizeError(error, { route: 'org.ts#updateStore', fallback: 'Failed to update store.' }) }
  }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteStore(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('stores').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#deleteStore', fallback: 'Failed to delete store.' }) }
  revalidatePath('/admin/org')
  return {}
}

// ── importStores ──────────────────────────────────────────────────────────────

export async function importStores(
  rows: { code: string; name: string; address?: string; city?: string; state?: string; pincode?: string; oem?: string; active?: string }[]
): Promise<ActionResult<{ imported: number; errors: string[] }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (rows.length === 0) return { error: 'No rows to import.' }

  const admin = createAdminClient()
  const orgId = guard.profile!.org_id!

  const { data: oemsData } = await admin.from('oems').select('id, name').eq('org_id', orgId)
  const oemByName = new Map<string, string>(
    (oemsData ?? []).map((o: { id: string; name: string }) => [o.name.trim().toLowerCase(), o.id])
  )

  const errors: string[] = []
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const rowLabel = `Row ${i + 2}`
    const code = rows[i].code?.trim().toUpperCase()
    const name = rows[i].name?.trim()
    if (!code) { errors.push(`${rowLabel}: store code is required, skipped.`); continue }
    if (!name) { errors.push(`${rowLabel}: name is required, skipped.`); continue }

    let oemId: string | null = null
    if (rows[i].oem?.trim()) {
      const found = oemByName.get(rows[i].oem!.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: OEM "${rows[i].oem}" not found, skipped.`); continue }
      oemId = found
    }

    const { error } = await admin.from('stores').insert({
      org_id: orgId,
      code,
      name,
      address: rows[i].address?.trim() || null,
      city: rows[i].city?.trim() || null,
      state: rows[i].state?.trim() || null,
      pincode: rows[i].pincode?.trim() || null,
      oem_id: oemId,
      is_active: isActiveValue(rows[i].active),
    })

    if (error) {
      errors.push(`${rowLabel}: ${error.code === '23505' ? `store code "${code}" already exists` : sanitizeError(error, { route: 'org.ts#importStores' })}, skipped.`)
      continue
    }
    imported++
  }

  revalidatePath('/admin/org')
  return { data: { imported, errors } }
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

  const admin = createAdminClient()
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

  if (error) return { error: sanitizeError(error, { route: 'org.ts#createCostCenter', fallback: 'Failed to create cost center.' }) }
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

  const admin = createAdminClient()
  const update: CostCenterUpdate = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if ('department_id' in fields) update.department_id = fields.department_id || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('cost_centers').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#updateCostCenter', fallback: 'Failed to update cost center.' }) }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteCostCenter(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('cost_centers').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#deleteCostCenter', fallback: 'Failed to delete cost center.' }) }
  revalidatePath('/admin/org')
  return {}
}

// ── Job Functions ────────────────────────────────────────────────────────────

export async function createJobFunction(fields: {
  name: string
  code?: string
  is_active?: boolean
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.name.trim()) return { error: 'Function name is required.' }
  if (!guard.profile!.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('job_functions')
    .insert({
      org_id: guard.profile!.org_id,
      name: fields.name.trim(),
      code: fields.code?.trim() || null,
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error || !data) return { error: sanitizeError(error, { route: 'org.ts#createJobFunction', fallback: 'Failed to create function.' }) }
  revalidatePath('/admin/org')
  return { data: { id: data.id } }
}

export async function updateJobFunction(
  id: string,
  fields: { name?: string; code?: string | null; is_active?: boolean }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const update: JobFunctionUpdate = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('job_functions').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#updateJobFunction', fallback: 'Failed to update function.' }) }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteJobFunction(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('job_functions').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#deleteJobFunction', fallback: 'Failed to delete function.' }) }
  revalidatePath('/admin/org')
  return {}
}

// ── Designations ─────────────────────────────────────────────────────────────

export async function createDesignation(fields: {
  name: string
  code?: string
  is_active?: boolean
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.name.trim()) return { error: 'Designation name is required.' }
  if (!guard.profile!.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('designations')
    .insert({
      org_id: guard.profile!.org_id,
      name: fields.name.trim(),
      code: fields.code?.trim() || null,
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error || !data) return { error: sanitizeError(error, { route: 'org.ts#createDesignation', fallback: 'Failed to create designation.' }) }
  revalidatePath('/admin/org')
  return { data: { id: data.id } }
}

export async function updateDesignation(
  id: string,
  fields: { name?: string; code?: string | null; is_active?: boolean }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const update: DesignationUpdate = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if ('code' in fields) update.code = fields.code?.trim() || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('designations').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#updateDesignation', fallback: 'Failed to update designation.' }) }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteDesignation(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('designations').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#deleteDesignation', fallback: 'Failed to delete designation.' }) }
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
    function_id?: string | null
    designation_id?: string | null
    employee_id?: string | null
    job_title?: string | null
    manager_id?: string | null
  }
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const orgId = guard.profile!.org_id!

  // createAdminClient() bypasses RLS — without this, nothing stops these
  // ids from pointing at another org's rows. See orgScopeGuard.ts.
  const refError = await assertRefsInOrg(admin, orgId, [
    ...(fields.department_id ? [{ table: 'departments', id: fields.department_id, label: 'department' }] : []),
    ...(fields.location_id ? [{ table: 'locations', id: fields.location_id, label: 'location' }] : []),
    ...(fields.cost_center_id ? [{ table: 'cost_centers', id: fields.cost_center_id, label: 'cost center' }] : []),
    ...(fields.function_id ? [{ table: 'job_functions', id: fields.function_id, label: 'function' }] : []),
    ...(fields.designation_id ? [{ table: 'designations', id: fields.designation_id, label: 'designation' }] : []),
    ...(fields.manager_id ? [{ table: 'profiles', id: fields.manager_id, label: 'manager' }] : []),
  ])
  if (refError) return { error: refError }

  const update: ProfileUpdate = { updated_at: new Date().toISOString() }
  if ('department_id' in fields) update.department_id = fields.department_id || null
  if ('location_id' in fields) update.location_id = fields.location_id || null
  if ('cost_center_id' in fields) update.cost_center_id = fields.cost_center_id || null
  if ('function_id' in fields) update.function_id = fields.function_id || null
  if ('designation_id' in fields) update.designation_id = fields.designation_id || null
  if ('employee_id' in fields) update.employee_id = fields.employee_id?.trim() || null
  if ('job_title' in fields) update.job_title = fields.job_title?.trim() || null
  if ('manager_id' in fields) update.manager_id = fields.manager_id || null

  const { error } = await admin.from('profiles').update(update).eq('id', userId).eq('org_id', orgId)
  if (error) return { error: sanitizeError(error, { route: 'org.ts#updateUserOrgFields', fallback: 'Failed to update user.' }) }
  revalidatePath('/admin/users')
  revalidatePath('/admin/org')
  return {}
}
