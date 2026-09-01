'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from './audit'
import type { RequestPriority } from '@/types'

type ActionResult = { error?: string }

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin','platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
}

// ── Top-level category CRUD ───────────────────────────────────────────────────

export type CategoryInput = {
  name: string
  description?: string
  icon?: string
  // Uploaded icon image — takes priority over `icon` (the emoji) whenever
  // set. See lib/actions/admin/icons.ts's uploadIconImage().
  icon_image_url?: string | null
  color?: string
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function createCategory(
  data: CategoryInput
): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  if (!data.name?.trim()) return { error: 'Name is required.' }

  const supabase = await createClient()

  const baseSlug = slugify(data.name.trim())
  const { data: existing } = await supabase
    .from('service_categories')
    .select('slug')
    .like('slug', `${baseSlug}%`)
  const usedSlugs = new Set((existing ?? []).map((r: { slug: string }) => r.slug))
  let slug = baseSlug
  let i = 2
  while (usedSlugs.has(slug)) { slug = `${baseSlug}-${i++}` }

  const { data: row, error } = await supabase
    .from('service_categories')
    .insert({
      org_id: guard.profile!.org_id,
      name: data.name.trim(),
      slug,
      description: data.description?.trim() || null,
      icon: data.icon?.trim() || null,
      icon_image_url: data.icon_image_url || null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createCategory]', error.message)
    return { error: 'Failed to create category.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service_category', entityId: row.id, action: 'category_created',
    metadata: { name: data.name.trim() },
  })

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return { id: row.id }
}

export async function updateCategory(
  id: string,
  data: Partial<CategoryInput>
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const payload = {
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
    ...(data.icon !== undefined ? { icon: data.icon?.trim() || null } : {}),
    ...(data.icon_image_url !== undefined ? { icon_image_url: data.icon_image_url || null } : {}),
  }

  const { error } = await supabase
    .from('service_categories')
    .update(payload)
    .eq('id', id)
  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service_category', entityId: id, action: 'category_updated',
    metadata: payload,
  })

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return {}
}

export async function toggleCategoryActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('service_categories')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service_category', entityId: id,
    action: isActive ? 'category_activated' : 'category_deactivated',
  })

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return {}
}

// ── deleteCategory ────────────────────────────────────────────────────────────
// Hard delete. Sub-categories cascade automatically (service_sub_categories.category_id
// ON DELETE CASCADE), which would in turn cascade-delete any service_sub_category_tags
// pointing at them — silently un-tagging services. Blocked up front instead, same
// intent as the old "services still use it" check, adapted to the tag relationship.

export async function deleteCategory(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const { data: category, error: fetchError } = await supabase
    .from('service_categories')
    .select('name')
    .eq('id', id)
    .single()

  if (fetchError || !category) return { error: 'Category not found.' }

  const { data: subCats } = await supabase
    .from('service_sub_categories')
    .select('id')
    .eq('category_id', id)
  const subCatIds = (subCats ?? []).map((s) => s.id)

  const { count: tagCount } = subCatIds.length > 0
    ? await supabase
        .from('service_sub_category_tags')
        .select('service_id', { count: 'exact', head: true })
        .in('sub_category_id', subCatIds)
    : { count: 0 }

  if (tagCount && tagCount > 0) {
    return {
      error: `Cannot delete "${category.name}" — ${tagCount} service${tagCount === 1 ? ' is' : 's are'} still tagged to one of its sub-categories. Retag or delete them first.`,
    }
  }

  const { error } = await supabase.from('service_categories').delete().eq('id', id)
  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service_category', entityId: id, action: 'category_deleted',
    metadata: { name: category.name },
  })

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return {}
}

// ── upsertSubCategory ─────────────────────────────────────────────────────────

export async function upsertSubCategory(
  input: {
    id?: string          // omit for create
    categoryId: string
    name: string
    description?: string
    icon?: string
    // Uploaded icon image — takes priority over `icon` (the emoji) whenever
    // set. See lib/actions/admin/icons.ts's uploadIconImage().
    iconImageUrl?: string | null
    sortOrder: number
    isActive?: boolean
    // Priority label auto-applied to a ticket's `priority` when this
    // sub-category is picked (optional — "not mandatory" per the SOP). The
    // actual response/resolution hours for that priority come from whichever
    // service's SLA Policy applies — a sub-category can be tagged by more than
    // one service, so it can't store literal hours itself. See
    // lib/sla/resolve.ts's resolveSlaDeadlines and lib/actions/requests.ts.
    slaPriority?: RequestPriority | null
  }
): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  if (!input.name.trim()) return { error: 'Name is required.' }

  const supabase = await createClient()

  const payload = {
    category_id: input.categoryId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    icon: input.icon?.trim() || null,
    icon_image_url: input.iconImageUrl || null,
    sort_order: input.sortOrder,
    is_active: input.isActive ?? true,
    sla_priority: input.slaPriority ?? null,
  }

  if (input.id) {
    // Update — slug is an internal identifier once set (never shown to the
    // admin, never regenerated from an edited name).
    const { error } = await supabase
      .from('service_sub_categories')
      .update(payload)
      .eq('id', input.id)
    if (error) return { error: error.message }

    await logAdminAudit({
      orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
      entityType: 'service_sub_category', entityId: input.id, action: 'sub_category_updated',
      metadata: { name: payload.name },
    })

    revalidatePath(`/admin/categories/${input.categoryId}`)
    revalidatePath('/services')
    return { id: input.id }
  } else {
    // Insert — auto-generate a slug from the name (never shown to the admin),
    // unique within this category (the actual DB constraint is per-category,
    // not global — service_sub_categories_category_id_slug_key).
    const baseSlug = slugify(input.name.trim()) || 'sub-category'
    const { data: existingSlugs } = await supabase
      .from('service_sub_categories')
      .select('slug')
      .eq('category_id', input.categoryId)
      .like('slug', `${baseSlug}%`)
    const usedSlugs = new Set((existingSlugs ?? []).map((r: { slug: string }) => r.slug))
    let slug = baseSlug
    let i = 2
    while (usedSlugs.has(slug)) { slug = `${baseSlug}-${i++}` }

    const { data, error } = await supabase
      .from('service_sub_categories')
      .insert({ ...payload, slug })
      .select('id')
      .single()
    if (error) return { error: error.message }

    await logAdminAudit({
      orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
      entityType: 'service_sub_category', entityId: data.id, action: 'sub_category_created',
      metadata: { name: payload.name, categoryId: input.categoryId },
    })

    revalidatePath('/admin/categories')
    revalidatePath('/services')
    return { id: data.id }
  }
}

// ── reorderSubCategories ──────────────────────────────────────────────────────

export async function reorderSubCategories(
  categoryId: string,
  orderedIds: string[]
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  // Run updates in parallel
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase
        .from('service_sub_categories')
        .update({ sort_order: idx })
        .eq('id', id)
        .eq('category_id', categoryId)
    )
  )

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service_sub_category', entityId: categoryId, action: 'sub_categories_reordered',
    metadata: { orderedIds },
  })

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return {}
}

// ── toggleSubCategoryActive ───────────────────────────────────────────────────

export async function toggleSubCategoryActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('service_sub_categories')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service_sub_category', entityId: id,
    action: isActive ? 'sub_category_activated' : 'sub_category_deactivated',
  })

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return {}
}

// ── deleteSubCategory ─────────────────────────────────────────────────────────
// Hard delete. service_sub_category_tags.sub_category_id is ON DELETE CASCADE —
// deleting a sub-category still in use would silently untag every service
// pointing at it, so that's blocked up front (same intent as deleteCategory).
// requests.sub_category_id is ON DELETE SET NULL, so already-submitted tickets
// are unaffected either way — only the ongoing tag relationship is guarded here.

export async function deleteSubCategory(id: string, categoryId: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const { data: subCategory, error: fetchError } = await supabase
    .from('service_sub_categories')
    .select('name')
    .eq('id', id)
    .single()

  if (fetchError || !subCategory) return { error: 'Sub-category not found.' }

  const { count: tagCount } = await supabase
    .from('service_sub_category_tags')
    .select('service_id', { count: 'exact', head: true })
    .eq('sub_category_id', id)

  if (tagCount && tagCount > 0) {
    return {
      error: `Cannot delete "${subCategory.name}" — ${tagCount} service${tagCount === 1 ? ' is' : 's are'} still tagged to it. Retag or delete them first.`,
    }
  }

  const { error } = await supabase.from('service_sub_categories').delete().eq('id', id)
  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service_sub_category', entityId: id, action: 'sub_category_deleted',
    metadata: { name: subCategory.name, categoryId },
  })

  revalidatePath(`/admin/categories/${categoryId}`)
  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return {}
}
