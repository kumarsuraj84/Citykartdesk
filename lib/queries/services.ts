import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import type {
  ServiceCategory,
  ServiceCategoryWithSubCategories,
  ServiceSubCategory,
  ServiceSubCategoryWithServices,
  ServiceWithRelations,
} from '@/types'

// ── Role-based status filter helper ───────────────────────────────────────────

/**
 * Returns an array of allowed service statuses for the current user.
 * - admin / manager / agent: all non-retired statuses
 * - regular user: published only
 */
async function getAllowedStatuses(): Promise<string[]> {
  const profile = await getCurrentProfile()
  const role = profile?.role ?? 'user'
  if (role === 'admin' || role === 'manager') {
    return ['draft', 'review', 'published']
  }
  return ['published']
}

// ── Shared select fragment ─────────────────────────────────────────────────────

const SERVICE_SELECT = `
  *,
  category:service_categories (*),
  sub_category:service_sub_categories (*),
  team:teams (*),
  approval_workflow:approval_workflows (*),
  owner:profiles!services_owner_id_fkey (id, full_name, avatar_url),
  backup_owner:profiles!services_backup_owner_id_fkey (id, full_name, avatar_url),
  escalation_policy:escalation_policies (*)
`

/**
 * Lean projection for catalog/browse views (cards). Excludes the heavy form/SLA JSONB
 * columns (form_fields, form_sections, form_schema_snapshot, sla_config, visibility_scope,
 * keywords) and the owner/approval/escalation relations — those are only needed on the
 * service launch page (getServiceBySlug) and admin editor. Keeps just what a card renders.
 */
const SERVICE_CARD_SELECT = `
  id, name, slug, icon, description, status, sort_order, is_active,
  category_id, sub_category_id, team_id, default_priority,
  category:service_categories (id, name, slug, icon),
  sub_category:service_sub_categories (id, name, slug),
  team:teams (id, name)
`

// ── Public catalog queries ─────────────────────────────────────────────────────

export async function getServiceCategories(): Promise<ServiceCategory[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  return data ?? []
}

/** Fetch all categories with their sub-categories and service counts for the catalog landing. */
export async function getCategoriesWithSubCategories(): Promise<ServiceCategoryWithSubCategories[]> {
  const [supabase, allowedStatuses] = await Promise.all([createClient(), getAllowedStatuses()])
  const { data } = await supabase
    .from('service_categories')
    .select(`
      *,
      sub_categories:service_sub_categories (
        *,
        services (${SERVICE_CARD_SELECT})
      )
    `)
    .eq('is_active', true)
    .order('sort_order')

  if (!data) return []

  // Filter sub-categories to active only, services to active + allowed status
  return data.map((cat) => ({
    ...cat,
    sub_categories: (cat.sub_categories ?? [])
      .filter((sc: ServiceSubCategory) => sc.is_active)
      .sort((a: ServiceSubCategory, b: ServiceSubCategory) => a.sort_order - b.sort_order)
      .map((sc: ServiceSubCategoryWithServices) => ({
        ...sc,
        services: ((sc.services ?? []) as ServiceWithRelations[])
          .filter((s) => s.is_active && allowedStatuses.includes((s as ServiceWithRelations & { status?: string }).status ?? 'published'))
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
  })) as ServiceCategoryWithSubCategories[]
}

/** Fetch a category by slug with its sub-categories for the category landing page. */
export async function getCategoryBySlug(slug: string): Promise<ServiceCategoryWithSubCategories | null> {
  const [supabase, allowedStatuses] = await Promise.all([createClient(), getAllowedStatuses()])
  const { data } = await supabase
    .from('service_categories')
    .select(`
      *,
      sub_categories:service_sub_categories (
        *,
        services (${SERVICE_CARD_SELECT})
      )
    `)
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!data) return null

  return {
    ...data,
    sub_categories: (data.sub_categories ?? [])
      .filter((sc: ServiceSubCategory) => sc.is_active)
      .sort((a: ServiceSubCategory, b: ServiceSubCategory) => a.sort_order - b.sort_order)
      .map((sc: ServiceSubCategoryWithServices) => ({
        ...sc,
        services: ((sc.services ?? []) as ServiceWithRelations[])
          .filter((s) => s.is_active && allowedStatuses.includes((s as ServiceWithRelations & { status?: string }).status ?? 'published'))
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
  } as ServiceCategoryWithSubCategories
}

/** Fetch a sub-category (and its services) by category slug + sub-category slug. */
export async function getSubCategoryBySlug(
  categorySlug: string,
  subSlug: string
): Promise<{ category: ServiceCategory; subCategory: ServiceSubCategoryWithServices } | null> {
  const supabase = await createClient()

  // First resolve the category
  const { data: cat } = await supabase
    .from('service_categories')
    .select('*')
    .eq('slug', categorySlug)
    .eq('is_active', true)
    .single()

  if (!cat) return null

  // Fetch sub-category and allowedStatuses in parallel
  const [{ data: sub }, allowedStatuses] = await Promise.all([
    supabase
      .from('service_sub_categories')
      .select(`*, services (${SERVICE_CARD_SELECT})`)
      .eq('category_id', cat.id)
      .eq('slug', subSlug)
      .eq('is_active', true)
      .single(),
    getAllowedStatuses(),
  ])

  if (!sub) return null

  return {
    category: cat as ServiceCategory,
    subCategory: {
      ...sub,
      services: ((sub.services ?? []) as ServiceWithRelations[])
        .filter((s) => s.is_active && allowedStatuses.includes((s as ServiceWithRelations & { status?: string }).status ?? 'published'))
        .sort((a, b) => a.sort_order - b.sort_order),
    } as ServiceSubCategoryWithServices,
  }
}

/** DB-side search — filters by name/description/keywords using Postgres ilike. */
export async function searchServices(query: string): Promise<ServiceWithRelations[]> {
  const [supabase, allowedStatuses] = await Promise.all([createClient(), getAllowedStatuses()])
  const safe = query.replace(/[%_]/g, '\\$&').slice(0, 100)
  let q = supabase
    .from('services')
    .select(SERVICE_CARD_SELECT)
    .eq('is_active', true)
    .or(`name.ilike.%${safe}%,description.ilike.%${safe}%`)
    .order('sort_order')
    .limit(50)

  if (allowedStatuses.length === 1 && allowedStatuses[0] === 'published') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = (q as any).eq('status', 'published')
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = (q as any).in('status', allowedStatuses)
  }

  const { data } = await q
  return (data ?? []) as ServiceWithRelations[]
}

export async function getServices(categoryId?: string, subCategoryId?: string): Promise<ServiceWithRelations[]> {
  const supabase = await createClient()
  let query = supabase
    .from('services')
    .select(SERVICE_SELECT)
    .eq('is_active', true)
    .order('sort_order')

  if (categoryId) query = query.eq('category_id', categoryId)
  if (subCategoryId) query = query.eq('sub_category_id', subCategoryId)

  const { data } = await query
  return (data ?? []) as ServiceWithRelations[]
}

export async function getServiceBySlug(slug: string): Promise<ServiceWithRelations | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('services')
    .select(SERVICE_SELECT)
    .eq('slug', slug)
    .eq('is_active', true)
    .single()
  return data as ServiceWithRelations | null
}

// ── Admin-only queries ─────────────────────────────────────────────────────────

export async function getServiceById(id: string): Promise<ServiceWithRelations | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('services')
    .select(SERVICE_SELECT)
    .eq('id', id)
    .single()
  return data as ServiceWithRelations | null
}

export async function getAllServicesForAdmin(): Promise<ServiceWithRelations[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('services')
    .select(SERVICE_SELECT)
    .order('sort_order')
  return (data ?? []) as ServiceWithRelations[]
}

/** Full category → sub-category → service tree for the admin form builder. Includes inactive items. */
export async function getCategoryTreeForAdmin(): Promise<ServiceCategoryWithSubCategories[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_categories')
    .select(`
      *,
      sub_categories:service_sub_categories (
        *,
        services (${SERVICE_SELECT})
      )
    `)
    .order('sort_order')

  if (!data) return []

  return data.map((cat) => ({
    ...cat,
    sub_categories: ((cat.sub_categories ?? []) as ServiceSubCategoryWithServices[])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((sc) => ({
        ...sc,
        services: ((sc.services ?? []) as ServiceWithRelations[])
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
  })) as ServiceCategoryWithSubCategories[]
}

/** All sub-categories for admin management. */
export async function getAllSubCategoriesForAdmin(): Promise<
  (ServiceSubCategory & { category: ServiceCategory })[]
> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_sub_categories')
    .select('*, category:service_categories (*)')
    .order('sort_order')
  return (data ?? []) as (ServiceSubCategory & { category: ServiceCategory })[]
}
