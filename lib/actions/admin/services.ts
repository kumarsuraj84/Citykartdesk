'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from './audit'
import type { FormSection, SLAConfig } from '@/types'

type ActionResult = { error?: string }

// ── Guard: admin-only ─────────────────────────────────────────────────────────

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin','platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
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
  category_id: string
  sub_category_id?: string
  team_id: string
  default_priority?: 'low' | 'medium' | 'high' | 'urgent'
  is_active?: boolean
  status?: 'draft' | 'review' | 'published' | 'retired'
  owner_id?: string | null
  backup_owner_id?: string | null
  version?: string
  visibility?: 'all' | 'agents_only' | 'managers_only'
  // Per-priority response/resolution hour overrides for this service. A priority tier
  // omitted here (or with a null field) falls back to a matching Field SLA Matrix
  // override if one exists, or otherwise gets no SLA deadline — see
  // lib/sla/resolve.ts resolveSlaDeadlines.
  sla_config?: SLAConfig
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
  if (!data.category_id) return { error: 'Category is required.' }
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
    category_id: data.category_id,
    sub_category_id: data.sub_category_id || null,
    team_id: data.team_id,
    default_priority: data.default_priority ?? 'medium',
    is_active: data.is_active ?? true,
    status: data.status ?? 'published',
    owner_id: data.owner_id ?? null,
    backup_owner_id: data.backup_owner_id ?? null,
    version: data.version?.trim() || '1.0',
    visibility: data.visibility ?? 'all',
    sla_config: data.sla_config ?? {},
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
    ...(data.category_id !== undefined ? { category_id: data.category_id } : {}),
    ...(data.sub_category_id !== undefined ? { sub_category_id: data.sub_category_id || null } : {}),
    ...(data.team_id !== undefined ? { team_id: data.team_id } : {}),
    ...(data.default_priority !== undefined ? { default_priority: data.default_priority } : {}),
    ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.owner_id !== undefined ? { owner_id: data.owner_id || null } : {}),
    ...(data.backup_owner_id !== undefined ? { backup_owner_id: data.backup_owner_id || null } : {}),
    ...(data.version !== undefined ? { version: data.version?.trim() || '1.0' } : {}),
    ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
    ...(data.sla_config !== undefined ? { sla_config: data.sla_config } : {}),
  }

  const { error } = await supabase
    .from('services')
    .update(updatePayload)
    .eq('id', id)

  if (error) {
    console.error('[updateService]', error.message)
    return { error: 'Failed to update service.' }
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
