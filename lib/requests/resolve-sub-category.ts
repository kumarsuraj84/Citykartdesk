import type { RequestPriority } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type SubCategoryResolution =
  | { ok: true; subCategoryId: string | null; categoryId: string | null; slaPriority: RequestPriority | null }
  | { ok: false; error: string }

/**
 * Validates a caller-supplied sub_category_id against the set actually
 * tagged to `serviceId` (service_sub_category_tags) and derives the category
 * from it — the one place this lookup happens, shared by createRequestCore()
 * (Stage 1) and the Stage 3 questionnaire engine's own revalidation step, so
 * the association rule can never drift between channels. Assumes `serviceId`
 * has already been validated to belong to the caller's org (every caller of
 * this function does that lookup itself first — see createRequestCore()'s
 * service query and questionnaire/subcategory.ts's own org-scoped check).
 *
 * No sub-categories tagged at all → optional (subCategoryId left null is
 * fine). One or more tagged → a selection is required, and it must be one of
 * the tagged set.
 */
export async function resolveSubCategoryForService(params: {
  client: AnyClient
  serviceId: string
  subCategoryId?: string | null
}): Promise<SubCategoryResolution> {
  const { client, serviceId, subCategoryId = null } = params

  type TaggedSubCat = { id: string; category_id: string; sla_priority: RequestPriority | null }
  const { data: taggedSubCats } = await client
    .from('service_sub_category_tags')
    .select('sub_category:service_sub_categories(id, category_id, sla_priority)')
    .eq('service_id', serviceId)

  const taggedList: TaggedSubCat[] = (taggedSubCats ?? [])
    .map((t: { sub_category: unknown }) => t.sub_category as TaggedSubCat | null)
    .filter((s: TaggedSubCat | null): s is TaggedSubCat => !!s)

  if (taggedList.length > 0 && !subCategoryId) return { ok: false, error: 'Category is required.' }

  const matched = subCategoryId ? taggedList.find((s) => s.id === subCategoryId) : undefined
  if (subCategoryId && !matched) return { ok: false, error: 'Selected category is not valid for this service.' }

  return {
    ok: true,
    subCategoryId: matched?.id ?? null,
    categoryId: matched?.category_id ?? null,
    slaPriority: matched?.sla_priority ?? null,
  }
}
