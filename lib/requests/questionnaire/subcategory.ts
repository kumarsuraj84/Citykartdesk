import { resolveSubCategoryForService } from '@/lib/requests/resolve-sub-category'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type SelectSubCategoryResult =
  | { ok: true; subCategoryId: string; categoryId: string | null }
  | { ok: false; error: string }

/**
 * Step 4/5: server-side revalidation of a sub-category the requester picked
 * (from searchSubCategories()'s results) plus category derivation — reuses
 * resolveSubCategoryForService(), the exact same helper createRequestCore()
 * itself calls, so the association rule can never drift between this
 * pre-creation revalidation step and the actual creation-time check.
 *
 * Category is never accepted directly — it only ever comes out of this
 * function as a derived value, matching the draft model's own invariant
 * (RequestDraft.categoryId is documented as "never set directly").
 */
export async function selectSubCategoryForDraft(params: {
  client: AnyClient
  orgId: string
  serviceId: string
  subCategoryId: string
}): Promise<SelectSubCategoryResult> {
  const { client, orgId, serviceId, subCategoryId } = params

  const { data: service } = await client
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!service) return { ok: false, error: 'Service not found.' }

  const resolution = await resolveSubCategoryForService({ client, serviceId, subCategoryId })
  if (!resolution.ok) return { ok: false, error: resolution.error }
  if (!resolution.subCategoryId) return { ok: false, error: 'Selected category is not valid for this service.' }

  return { ok: true, subCategoryId: resolution.subCategoryId, categoryId: resolution.categoryId }
}
