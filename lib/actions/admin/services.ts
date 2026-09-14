'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from './audit'
import type { FormSection } from '@/types'

type ActionResult = { error?: string }

// ── Guard: admin-only ─────────────────────────────────────────────────────────

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin','platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
}

// ── Friendly message for a sub_category_id tag conflict ────────────────────────
// service_sub_category_tags.sub_category_id is UNIQUE — a race between two
// admins tagging the same sub-category to different services surfaces here as
// a raw Postgres "duplicate key value violates unique constraint" error. This
// looks up which sub-category(ies) and which other service actually holds
// them, so the admin sees the same "Used by X" message the picker's
// client-side check already shows for the non-race case, instead of a
// Postgres internals string.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function describeTagConflict(supabase: any, subCategoryIds: string[], excludeServiceId?: string): Promise<string> {
  let query = supabase
    .from('service_sub_category_tags')
    .select('sub_category:service_sub_categories(name), service:services(name)')
    .in('sub_category_id', subCategoryIds)
  if (excludeServiceId) query = query.neq('service_id', excludeServiceId)
  const { data } = await query
  const conflicts = (data ?? []) as { sub_category: { name: string } | null; service: { name: string } | null }[]
  if (conflicts.length === 0) return 'One or more of these categories is already tagged to another service.'
  const list = conflicts.map((c) => `"${c.sub_category?.name ?? '?'}" (already tagged to "${c.service?.name ?? '?'}")`).join(', ')
  return `Couldn't tag: ${list} — untag ${conflicts.length === 1 ? 'it' : 'them'} there first.`
}

// ── Validate sections ─────────────────────────────────────────────────────────

function validateSections(sections: FormSection[]): string | null {
  if (!Array.isArray(sections)) return 'Sections must be an array.'

  const allFieldIds = new Set<string>()

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]

    if (!section.id?.trim()) return `Section ${si + 1}: id is required.`
    if (!section.title?.trim()) return `Section ${si + 1}: title is required.`

    if (!Array.isArray(section.fields)) {
      return `Section "${section.title}": fields must be an array.`
    }

    for (let fi = 0; fi < section.fields.length; fi++) {
      const field = section.fields[fi]

      if (!field.id?.trim()) {
        return `Section "${section.title}", field ${fi + 1}: id is required.`
      }
      if (!field.label?.trim()) {
        return `Section "${section.title}", field ${fi + 1}: label is required.`
      }

      // Field IDs must be globally unique across all sections
      if (allFieldIds.has(field.id)) {
        return `Duplicate field id "${field.id}" found across sections. Field IDs must be unique.`
      }
      allFieldIds.add(field.id)

      // Select / multiselect must have options
      if (
        (field.type === 'select' || field.type === 'multiselect') &&
        (!field.options || field.options.length === 0)
      ) {
        return `Section "${section.title}", field "${field.label}": select/multiselect fields require at least one option.`
      }

      if (field.requester_can_set === true && field.requester_can_view === false) {
        return `Section "${section.title}", field "${field.label}": cannot be settable by requesters while hidden from them.`
      }
    }
  }

  return null
}

// ── saveFormSections ──────────────────────────────────────────────────────────

export async function saveFormSections(
  serviceId: string,
  sections: FormSection[]
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const validationError = validateSections(sections)
  if (validationError) return { error: validationError }

  // Re-index order to ensure it matches array position
  const normalised: FormSection[] = sections.map((section, si) => ({
    ...section,
    order: si,
    fields: section.fields.map((field, fi) => ({ ...field, order: fi })),
  }))

  // Use admin client to bypass RLS — auth is already checked by requireAdmin() above
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as any

  const { error } = await admin
    .from('services')
    .update({ form_sections: normalised })
    .eq('id', serviceId)
    .eq('org_id', guard.profile!.org_id!)

  if (error) {
    console.error('[saveFormSections]', error.code, error.message, error.details)
    return { error: `Save failed: ${error.message}` }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service', entityId: serviceId, action: 'service_form_updated',
    metadata: { section_count: normalised.length },
  })

  revalidatePath(`/admin/services/${serviceId}`)
  revalidatePath(`/services`) // invalidate service catalog cache

  return {}
}

// ── Service metadata CRUD ──────────────────────────────────────────────────────

export type ServiceInput = {
  name: string
  description?: string
  icon?: string
  // Uploaded icon image (Service Desk → Service Catalog's icon picker) —
  // takes priority over `icon` (the emoji) whenever set. See
  // lib/actions/admin/icons.ts's uploadIconImage().
  icon_image_url?: string | null
  // Sub-categories this service is tagged to — the requester picks one at
  // submission time as a built-in form field (see resolveServiceFormSections()'s
  // sibling picker in DynamicForm). A service is no longer nested under a
  // single category/sub-category; this replaces that structural placement.
  sub_category_tag_ids?: string[]
  // Locations (HO/Stores/Warehouse/etc.) this service is visible to for the
  // Requester role — empty/omitted means visible to every location (today's
  // behavior for every existing service). Agents/managers/admins always see
  // every service in the catalog regardless of this tagging; only affects
  // what a plain Requester's own /services browse shows them. See
  // getServices() in lib/queries/services.ts.
  location_tag_ids?: string[]
  team_id: string
  default_priority?: 'low' | 'medium' | 'high' | 'urgent'
  is_active?: boolean
  status?: 'draft' | 'review' | 'published' | 'retired'
  owner_id?: string | null
  backup_owner_id?: string | null
  version?: string
  visibility?: 'all' | 'agents_only' | 'managers_only'
  // The SLA Policy this service is mapped to (Service Desk → SLA Policies) —
  // null/undefined means unmapped, in which case only a matching Field SLA
  // Matrix override (if any) applies; otherwise the request gets no SLA
  // deadline. See lib/sla/resolve.ts resolveSlaDeadlines.
  sla_policy_id?: string | null
  // Form Template this service is tagged to — null/undefined means untagged,
  // in which case the service keeps rendering its own form_sections/form_fields
  // (see lib/forms/sections.ts's resolveServiceFormSections()). Once tagged, the
  // service's own form is never read: the template is the live source of truth.
  template_id?: string | null
  // When true, a ticket raised on this service auto-emails the requester's
  // store's assigned OEM (if any), posts a system comment, and flips status
  // straight to in_progress — see runOemAutoRouting() in lib/actions/requests.ts.
  auto_oem_routing?: boolean
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function createService(
  data: ServiceInput
): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  if (!data.name?.trim()) return { error: 'Name is required.' }
  if (!data.team_id) return { error: 'Team is required.' }

  const supabase = await createClient()

  // Generate a unique slug
  const baseSlug = slugify(data.name.trim())
  const { data: existing } = await supabase
    .from('services')
    .select('slug')
    .like('slug', `${baseSlug}%`)
  const usedSlugs = new Set((existing ?? []).map((r: { slug: string }) => r.slug))
  let slug = baseSlug
  let i = 2
  while (usedSlugs.has(slug)) { slug = `${baseSlug}-${i++}` }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: any = {
    org_id: guard.profile!.org_id,
    name: data.name.trim(),
    slug,
    description: data.description?.trim() || null,
    icon: data.icon?.trim() || null,
    icon_image_url: data.icon_image_url || null,
    team_id: data.team_id,
    default_priority: data.default_priority ?? 'medium',
    is_active: data.is_active ?? true,
    status: data.status ?? 'published',
    owner_id: data.owner_id ?? null,
    backup_owner_id: data.backup_owner_id ?? null,
    version: data.version?.trim() || '1.0',
    visibility: data.visibility ?? 'all',
    sla_policy_id: data.sla_policy_id || null,
    template_id: data.template_id || null,
    auto_oem_routing: data.auto_oem_routing ?? false,
  }

  const { data: row, error } = await supabase
    .from('services')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) {
    console.error('[createService]', error.message)
    return { error: 'Failed to create service.' }
  }

  if (data.sub_category_tag_ids && data.sub_category_tag_ids.length > 0) {
    const { error: tagError } = await supabase
      .from('service_sub_category_tags')
      .insert(data.sub_category_tag_ids.map((sub_category_id) => ({ service_id: row.id, sub_category_id })))
    if (tagError) {
      console.error('[createService] tag', tagError.message)
      const message = tagError.code === '23505'
        ? await describeTagConflict(supabase, data.sub_category_tag_ids, row.id)
        : tagError.message
      return { error: `Service created, but tagging categories failed: ${message}` }
    }
  }

  if (data.location_tag_ids && data.location_tag_ids.length > 0) {
    const { error: locError } = await supabase
      .from('service_location_tags')
      .insert(data.location_tag_ids.map((location_id) => ({ service_id: row.id, location_id })))
    if (locError) {
      console.error('[createService] location tag', locError.message)
      return { error: `Service created, but tagging locations failed: ${locError.message}` }
    }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service', entityId: row.id, action: 'service_created',
    metadata: { name: data.name.trim() },
  })

  revalidatePath('/admin/services')
  revalidatePath('/services')
  return { id: row.id }
}

export async function updateService(
  id: string,
  data: Partial<ServiceInput>
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePayload: any = {
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
    ...(data.icon !== undefined ? { icon: data.icon?.trim() || null } : {}),
    ...(data.icon_image_url !== undefined ? { icon_image_url: data.icon_image_url || null } : {}),
    ...(data.team_id !== undefined ? { team_id: data.team_id } : {}),
    ...(data.default_priority !== undefined ? { default_priority: data.default_priority } : {}),
    ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.owner_id !== undefined ? { owner_id: data.owner_id || null } : {}),
    ...(data.backup_owner_id !== undefined ? { backup_owner_id: data.backup_owner_id || null } : {}),
    ...(data.version !== undefined ? { version: data.version?.trim() || '1.0' } : {}),
    ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
    ...(data.sla_policy_id !== undefined ? { sla_policy_id: data.sla_policy_id || null } : {}),
    ...(data.template_id !== undefined ? { template_id: data.template_id || null } : {}),
    ...(data.auto_oem_routing !== undefined ? { auto_oem_routing: data.auto_oem_routing } : {}),
  }

  const { error } = await supabase
    .from('services')
    .update(updatePayload)
    .eq('id', id)

  if (error) {
    console.error('[updateService]', error.message)
    return { error: 'Failed to update service.' }
  }

  // Replace-all: only touched when the caller actually sent a tag set (the
  // modal always sends one, but a partial/programmatic update might not).
  // Delete+insert happens atomically inside retag_service_categories() — a
  // failed insert (e.g. a race losing the sub_category_id uniqueness check)
  // rolls back the delete too, instead of leaving the service with zero tags.
  if (data.sub_category_tag_ids !== undefined) {
    const { error: tagError } = await supabase.rpc('retag_service_categories', {
      p_service_id: id,
      p_sub_category_ids: data.sub_category_tag_ids,
    })
    if (tagError) {
      console.error('[updateService] retag', tagError.message)
      const message = tagError.code === '23505'
        ? await describeTagConflict(supabase, data.sub_category_tag_ids, id)
        : tagError.message
      return { error: `Retagging categories failed, your previous tags are unchanged: ${message}` }
    }
  }

  if (data.location_tag_ids !== undefined) {
    const { error: locError } = await supabase.rpc('retag_service_locations', {
      p_service_id: id,
      p_location_ids: data.location_tag_ids,
    })
    if (locError) {
      console.error('[updateService] retag locations', locError.message)
      return { error: `Retagging locations failed, your previous tags are unchanged: ${locError.message}` }
    }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service', entityId: id, action: 'service_updated',
    metadata: updatePayload,
  })

  revalidatePath('/admin/services')
  revalidatePath('/services')
  return {}
}

export async function archiveService(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('services')
    .update({ is_active: false })
    .eq('id', id)

  if (error) {
    console.error('[archiveService]', error.message)
    return { error: 'Failed to archive service.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service', entityId: id, action: 'service_archived',
  })

  revalidatePath('/admin/services')
  revalidatePath('/services')
  return {}
}

// ── deleteService ─────────────────────────────────────────────────────────────
// Hard delete. `requests.service_id` is a NOT-NULL, RESTRICT-on-delete foreign
// key — a service that still has requests attached cannot be removed at the DB
// level, so we check for that up front and return a clear, actionable error
// instead of surfacing a raw Postgres FK-violation message.
//
// field_sla_overrides.service_id is ON DELETE CASCADE (unlike requests, which
// blocks) — a service with configured Field SLA Matrix rows but zero requests
// would otherwise be deletable with no warning, silently wiping that
// configuration along with it. Blocked here the same way requests are.

export async function deleteService(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const { data: service, error: fetchError } = await supabase
    .from('services')
    .select('name')
    .eq('id', id)
    .single()

  if (fetchError || !service) return { error: 'Service not found.' }

  const { count: requestCount } = await supabase
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('service_id', id)

  if (requestCount && requestCount > 0) {
    return {
      error: `Cannot delete "${service.name}" — ${requestCount} request${requestCount === 1 ? '' : 's'} reference it. Archive it instead, or delete/reassign those requests first.`,
    }
  }

  const { count: slaOverrideCount } = await supabase
    .from('field_sla_overrides')
    .select('id', { count: 'exact', head: true })
    .eq('service_id', id)

  if (slaOverrideCount && slaOverrideCount > 0) {
    return {
      error: `Cannot delete "${service.name}" — it has ${slaOverrideCount} Field SLA Matrix entr${slaOverrideCount === 1 ? 'y' : 'ies'} configured. Clear them from Request Configuration → Field SLA Matrix first, or archive the service instead.`,
    }
  }

  const { error } = await supabase.from('services').delete().eq('id', id)

  if (error) {
    console.error('[deleteService]', error.message)
    return { error: 'Failed to delete service.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service', entityId: id, action: 'service_deleted',
    metadata: { name: service.name },
  })

  revalidatePath('/admin/services')
  revalidatePath('/services')
  return {}
}
