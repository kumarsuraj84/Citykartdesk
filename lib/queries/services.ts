import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import type {
  AllowedSubCategory,
  ServiceCategory,
  ServiceCategoryWithSubCategories,
  ServiceSubCategory,
  ServiceWithRelations,
  SlaPolicy,
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
// A service no longer owns a category/sub-category (that's now a submission-
// time field, tagged to the service many-to-many via service_sub_category_tags —
// see getAllowedSubCategoriesForService below) so neither select fragment joins
// category/sub_category anymore.

const SERVICE_SELECT = `
  *,
  team:teams (*),
  approval_workflow:approval_workflows (*),
  owner:profiles!services_owner_id_fkey (id, full_name, avatar_url),
  backup_owner:profiles!services_backup_owner_id_fkey (id, full_name, avatar_url),
  escalation_policy:escalation_policies (*),
  template:form_templates (id, name, form_sections),
  sla_policy:sla_policies (id, name, config)
`

/**
 * Lean projection for catalog/browse views (cards). Excludes the heavy form JSONB
 * columns (form_fields, form_sections, form_schema_snapshot, visibility_scope,
 * keywords) and the owner/approval/escalation/SLA-policy relations — those are only
 * needed on the service launch page (getServiceBySlug) and admin editor. Keeps just
 * what a card renders.
 */
const SERVICE_CARD_SELECT = `
  id, name, slug, icon, icon_image_url, description, status, sort_order, is_active, team_id, default_priority,
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

/** Category + its sub-categories, for the admin Categories detail page
 *  (Admin sees everything regardless of active/inactive — this isn't the
 *  requester-facing catalog browsing that used to live here). */
export async function getCategoryBySlug(slug: string): Promise<ServiceCategoryWithSubCategories | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_categories')
    .select(`*, sub_categories:service_sub_categories (*)`)
    .eq('slug', slug)
    .single()

  if (!data) return null

  return {
    ...data,
    sub_categories: ((data.sub_categories ?? []) as ServiceSubCategory[])
      .sort((a, b) => a.sort_order - b.sort_order),
  } as ServiceCategoryWithSubCategories
}

/** DB-side search — filters by name/description using Postgres ilike. Flat, no category grouping. */
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

/** Flat, active-and-visible service list for the /services catalog root — the
 *  whole catalog is now a flat list of broad services, no category tree to browse. */
export async function getServices(): Promise<ServiceWithRelations[]> {
  const [supabase, allowedStatuses] = await Promise.all([createClient(), getAllowedStatuses()])
  let query = supabase
    .from('services')
    .select(SERVICE_CARD_SELECT)
    .eq('is_active', true)
    .order('sort_order')

  if (allowedStatuses.length === 1 && allowedStatuses[0] === 'published') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).eq('status', 'published')
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).in('status', allowedStatuses)
  }

  const { data } = await query
  return (data ?? []) as ServiceWithRelations[]
}

export type ServiceSubCategoryFilterOption = { id: string; name: string; category_name: string }

/** Lean active sub-category list for the requests table's Sub Category column filter. */
export async function getServiceSubCategoriesForFilter(): Promise<ServiceSubCategoryFilterOption[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_sub_categories')
    .select('id, name, category:service_categories(name)')
    .eq('is_active', true)
    .order('sort_order')
  return ((data ?? []) as unknown as { id: string; name: string; category: { name: string } | null }[])
    .map((s) => ({ id: s.id, name: s.name, category_name: s.category?.name ?? '—' }))
}

/** Lean active-service list for the "move to a different service" reclassify
 *  control — services no longer carry a category, so this is just {id, name}. */
export async function getActiveServicesForReclassify(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('sort_order')
  return data ?? []
}

/** Sub-categories a service is tagged to (grouped by category), for (a) the
 *  built-in Category/Sub-category picker on the submission form and (b) the
 *  "change category" reclassify control — the requester/agent picks one. */
export async function getAllowedSubCategoriesForService(serviceId: string): Promise<AllowedSubCategory[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_sub_category_tags')
    .select('sub_category:service_sub_categories(id, name, category_id, category:service_categories(name))')
    .eq('service_id', serviceId)
  return ((data ?? []) as unknown as { sub_category: { id: string; name: string; category_id: string; category: { name: string } | null } | null }[])
    .filter((r) => r.sub_category)
    .map((r) => ({
      id: r.sub_category!.id,
      name: r.sub_category!.name,
      category_id: r.sub_category!.category_id,
      category_name: r.sub_category!.category?.name ?? '—',
    }))
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

export type ServiceWithTags = ServiceWithRelations & { sub_category_tag_ids: string[] }

/** Admin Service Catalog list — each service plus which sub-categories it's
 *  tagged to, so the edit modal's "Tag Categories" checklist can pre-check
 *  the right ones. */
export async function getAllServicesForAdmin(): Promise<ServiceWithTags[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('services')
    .select(`${SERVICE_SELECT}, tags:service_sub_category_tags(sub_category_id)`)
    .order('sort_order')
  return ((data ?? []) as unknown as (ServiceWithRelations & { tags: { sub_category_id: string }[] })[])
    .map(({ tags, ...s }) => ({ ...s, sub_category_tag_ids: tags.map((t) => t.sub_category_id) }))
}

/** Category → sub-category tree (no services nested — they're tagged, not
 *  nested, now) for the admin Categories screen and the Service Catalog's
 *  "Tag Categories" picker. Includes inactive items. */
export async function getCategoryTreeForAdmin(): Promise<ServiceCategoryWithSubCategories[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_categories')
    .select(`*, sub_categories:service_sub_categories (*)`)
    .order('sort_order')

  if (!data) return []

  return data.map((cat) => ({
    ...cat,
    sub_categories: ((cat.sub_categories ?? []) as ServiceSubCategory[])
      .sort((a, b) => a.sort_order - b.sort_order),
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

// ── Form Templates ─────────────────────────────────────────────────────────────

export type FormTemplateSummary = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  updated_at: string
  service_count: number
}

/** All active templates for the library page, with how many services are tagged to each. */
export async function getFormTemplates(): Promise<FormTemplateSummary[]> {
  const supabase = await createClient()
  const [{ data: templates }, { data: services }] = await Promise.all([
    supabase
      .from('form_templates')
      .select('id, name, description, is_active, updated_at')
      .eq('is_active', true)
      .order('name'),
    supabase.from('services').select('template_id').not('template_id', 'is', null),
  ])

  const counts = new Map<string, number>()
  for (const s of services ?? []) {
    const id = (s as { template_id: string | null }).template_id
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return (templates ?? []).map((t) => ({ ...t, service_count: counts.get(t.id) ?? 0 }))
}

export type FormTemplateWithSections = {
  id: string
  name: string
  description: string | null
  form_sections: unknown
}

export async function getFormTemplateById(id: string): Promise<FormTemplateWithSections | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('form_templates')
    .select('id, name, description, form_sections')
    .eq('id', id)
    .single()
  return data
}

/** Lean {id, name} list for the Service Catalog's "Tag a template" picker. */
export async function getActiveFormTemplatesForPicker(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('form_templates')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  return data ?? []
}

// ── SLA Policies ──────────────────────────────────────────────────────────────

/** Lean {id, name} list for the Service Catalog's "SLA Policy" picker. */
export async function getActiveSlaPoliciesForPicker(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('sla_policies')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  return data ?? []
}

export type SlaPolicySummary = SlaPolicy & { service_count: number }

/** All SLA policies for the admin library page, with how many services are mapped to each. */
export async function getSlaPolicies(): Promise<SlaPolicySummary[]> {
  const supabase = await createClient()
  const [{ data: policies }, { data: services }] = await Promise.all([
    supabase
      .from('sla_policies')
      .select('id, org_id, name, description, config, is_active, created_at, updated_at')
      .order('name'),
    supabase.from('services').select('sla_policy_id').not('sla_policy_id', 'is', null),
  ])

  const counts = new Map<string, number>()
  for (const s of services ?? []) {
    const id = (s as { sla_policy_id: string | null }).sla_policy_id
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return (policies ?? []).map((p) => ({ ...p, service_count: counts.get(p.id) ?? 0 })) as SlaPolicySummary[]
}
