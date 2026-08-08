'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'

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
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createCategory]', error.message)
    return { error: 'Failed to create category.' }
  }

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

  const { error } = await supabase
    .from('service_categories')
    .update({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
      ...(data.icon !== undefined ? { icon: data.icon?.trim() || null } : {}),
    })
    .eq('id', id)
  if (error) return { error: error.message }

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
    slug: string
    description?: string
    icon?: string
    sortOrder: number
    isActive?: boolean
  }
): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  if (!input.name.trim()) return { error: 'Name is required.' }
  if (!input.slug.trim()) return { error: 'Slug is required.' }
  // Basic slug validation
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    return { error: 'Slug may only contain lowercase letters, numbers, and hyphens.' }
  }

  const supabase = await createClient()

  const payload = {
    category_id: input.categoryId,
    name: input.name.trim(),
    slug: input.slug.trim(),
    description: input.description?.trim() || null,
    icon: input.icon?.trim() || null,
    sort_order: input.sortOrder,
    is_active: input.isActive ?? true,
  }

  if (input.id) {
    // Update
    const { error } = await supabase
      .from('service_sub_categories')
      .update(payload)
      .eq('id', input.id)
    if (error) return { error: error.message }
    revalidatePath(`/admin/categories/${input.categoryId}`)
    revalidatePath('/services')
    return { id: input.id }
  } else {
    // Insert
    const { data, error } = await supabase
      .from('service_sub_categories')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { error: error.message }
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

  revalidatePath('/admin/categories')
  revalidatePath('/services')
  return {}
}
