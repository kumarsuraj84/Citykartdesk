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

// ── bulkImportCategories ─────────────────────────────────────────────────────
// One row per (category, sub-category) pair — a category repeated across rows
// is only created once and reused for the rest, matching how someone would
// naturally fill in a spreadsheet with several sub-categories per category.

export type CategoryImportRow = {
  category_name?: string
  category_description?: string
  category_icon?: string
  sub_category_name?: string
  sub_category_description?: string
  sub_category_icon?: string
  sla_priority?: string
}

const VALID_IMPORT_PRIORITIES: RequestPriority[] = ['low', 'medium', 'high', 'urgent']

export async function bulkImportCategories(
  rows: CategoryImportRow[]
): Promise<{ error?: string; data?: { imported: number; errors: string[] } }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard
  if (rows.length === 0) return { error: 'No rows to import.' }

  const supabase = await createClient()
  const orgId = guard.profile!.org_id
  if (!orgId) return { error: 'Your account is not linked to an organisation.' }

  const { data: existingCategories } = await supabase
    .from('service_categories')
    .select('id, name, slug')
    .eq('org_id', orgId)

  const categoryByName = new Map<string, { id: string; slug: string }>(
    (existingCategories ?? []).map((c) => [c.name.trim().toLowerCase(), { id: c.id, slug: c.slug }])
  )
  const usedCategorySlugs = new Set((existingCategories ?? []).map((c) => c.slug))
  const existingCategoryIds = (existingCategories ?? []).map((c) => c.id)

  const { data: existingSubCats } = existingCategoryIds.length > 0
    ? await supabase
        .from('service_sub_categories')
        .select('id, name, slug, category_id, sort_order')
        .in('category_id', existingCategoryIds)
    : { data: [] as { id: string; name: string; slug: string; category_id: string; sort_order: number }[] }

  const subCatNamesByCategory = new Map<string, Set<string>>()
  const subCatSlugsByCategory = new Map<string, Set<string>>()
  const nextSortOrderByCategory = new Map<string, number>()
  for (const sc of existingSubCats ?? []) {
    const names = subCatNamesByCategory.get(sc.category_id) ?? new Set<string>()
    names.add(sc.name.trim().toLowerCase())
    subCatNamesByCategory.set(sc.category_id, names)

    const slugs = subCatSlugsByCategory.get(sc.category_id) ?? new Set<string>()
    slugs.add(sc.slug)
    subCatSlugsByCategory.set(sc.category_id, slugs)

    const currentMax = nextSortOrderByCategory.get(sc.category_id) ?? 0
    nextSortOrderByCategory.set(sc.category_id, Math.max(currentMax, sc.sort_order + 1))
  }

  const errors: string[] = []
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const rowLabel = `Row ${i + 2}`
    const row = rows[i]
    const categoryName = row.category_name?.trim()
    const subCategoryName = row.sub_category_name?.trim()

    if (!categoryName) { errors.push(`${rowLabel}: category name is required, skipped.`); continue }
    if (!subCategoryName) { errors.push(`${rowLabel}: sub-category name is required, skipped.`); continue }

    let slaPriority: RequestPriority | null = null
    if (row.sla_priority?.trim()) {
      const candidate = row.sla_priority.trim().toLowerCase()
      if (!VALID_IMPORT_PRIORITIES.includes(candidate as RequestPriority)) {
        errors.push(`${rowLabel}: SLA priority "${row.sla_priority}" is invalid (use low/medium/high/urgent), skipped.`)
        continue
      }
      slaPriority = candidate as RequestPriority
    }

    let category = categoryByName.get(categoryName.toLowerCase())
    if (!category) {
      const baseSlug = slugify(categoryName) || 'category'
      let slug = baseSlug
      let n = 2
      while (usedCategorySlugs.has(slug)) { slug = `${baseSlug}-${n++}` }
      usedCategorySlugs.add(slug)

      const { data: newCat, error: catError } = await supabase
        .from('service_categories')
        .insert({
          org_id: orgId,
          name: categoryName,
          slug,
          description: row.category_description?.trim() || null,
          icon: row.category_icon?.trim() || null,
        })
        .select('id, slug')
        .single()
      if (catError || !newCat) {
        errors.push(`${rowLabel}: failed to create category "${categoryName}", skipped.`)
        continue
      }
      category = { id: newCat.id, slug: newCat.slug }
      categoryByName.set(categoryName.toLowerCase(), category)

      await logAdminAudit({
        orgId: orgId!, actorId: guard.profile!.id,
        entityType: 'service_category', entityId: category.id, action: 'category_created',
        metadata: { name: categoryName, via: 'bulk_import' },
      })
    }

    const existingNames = subCatNamesByCategory.get(category.id) ?? new Set<string>()
    if (existingNames.has(subCategoryName.toLowerCase())) {
      errors.push(`${rowLabel}: sub-category "${subCategoryName}" already exists under "${categoryName}", skipped.`)
      continue
    }

    const subSlugs = subCatSlugsByCategory.get(category.id) ?? new Set<string>()
    const baseSubSlug = slugify(subCategoryName) || 'sub-category'
    let subSlug = baseSubSlug
    let m = 2
    while (subSlugs.has(subSlug)) { subSlug = `${baseSubSlug}-${m++}` }
    subSlugs.add(subSlug)
    subCatSlugsByCategory.set(category.id, subSlugs)

    const sortOrder = nextSortOrderByCategory.get(category.id) ?? 0
    nextSortOrderByCategory.set(category.id, sortOrder + 1)

    const { data: newSubCat, error: subError } = await supabase
      .from('service_sub_categories')
      .insert({
        category_id: category.id,
        name: subCategoryName,
        slug: subSlug,
        description: row.sub_category_description?.trim() || null,
        icon: row.sub_category_icon?.trim() || null,
        sort_order: sortOrder,
        is_active: true,
        sla_priority: slaPriority,
      })
      .select('id')
      .single()

    if (subError || !newSubCat) {
      errors.push(`${rowLabel}: failed to create sub-category "${subCategoryName}", skipped.`)
      continue
    }

    existingNames.add(subCategoryName.toLowerCase())
    subCatNamesByCategory.set(category.id, existingNames)

    await logAdminAudit({
      orgId: orgId!, actorId: guard.profile!.id,
      entityType: 'service_sub_category', entityId: newSubCat.id, action: 'sub_category_created',
      metadata: { name: subCategoryName, categoryId: category.id, via: 'bulk_import' },
    })

    imported++
  }

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return { data: { imported, errors } }
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
