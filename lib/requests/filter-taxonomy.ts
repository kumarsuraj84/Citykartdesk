// The Service / Category / Sub Category filters of the ticket lists are linked: a Category is offered only for the chosen Service, and a Sub Category only
// for the chosen Category (and Service). A choice that no longer fits (the Service was changed after a Category was picked) is dropped, never silently
// applied, so a list can never be empty because of a leftover filter the person cannot see.

export interface TaxonomyService { id: string; name: string }
export interface TaxonomyCategory { id: string; name: string }
export interface TaxonomySubCategory { id: string; name: string; category_id: string; category_name: string }
/** A sub-category a service may be raised under (service_sub_category_tags). */
export interface TaxonomyTag { service_id: string; sub_category_id: string }

export interface FilterTaxonomy {
  services: TaxonomyService[]
  categories: TaxonomyCategory[]
  subCategories: TaxonomySubCategory[]
  tags: TaxonomyTag[]
}

export interface TaxonomyChoice { service?: string; category?: string; subcategory?: string }

export interface ScopedTaxonomy {
  /** what is really applied to the list: a choice that does not fit the one above it is gone */
  effective: TaxonomyChoice
  categories: TaxonomyCategory[]
  subCategories: TaxonomySubCategory[]
}

export function scopeTaxonomy(tx: FilterTaxonomy, choice: TaxonomyChoice): ScopedTaxonomy {
  const service = choice.service && tx.services.some((s) => s.id === choice.service) ? choice.service : undefined

  // sub-categories this service can be raised under (every sub-category when no service is chosen)
  let subs = tx.subCategories
  if (service) {
    const allowed = new Set(tx.tags.filter((t) => t.service_id === service).map((t) => t.sub_category_id))
    subs = subs.filter((s) => allowed.has(s.id))
  }

  // categories that still have at least one such sub-category
  const categoryIds = new Set(subs.map((s) => s.category_id))
  const categories = tx.categories.filter((c) => categoryIds.has(c.id))
  const category = choice.category && categories.some((c) => c.id === choice.category) ? choice.category : undefined

  const subCategories = category ? subs.filter((s) => s.category_id === category) : subs
  const subcategory = choice.subcategory && subCategories.some((s) => s.id === choice.subcategory) ? choice.subcategory : undefined

  return { effective: { service, category, subcategory }, categories, subCategories }
}
