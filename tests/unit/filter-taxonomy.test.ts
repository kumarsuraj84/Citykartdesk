import { describe, it, expect } from 'vitest'
import { scopeTaxonomy, type FilterTaxonomy } from '@/lib/requests/filter-taxonomy'

// IT service has IT Support (barcode printer, mouse); Finance service has Ginesys (invoice). Admin has a category no service uses.
const tx: FilterTaxonomy = {
  services: [{ id: 's-it', name: 'IT' }, { id: 's-fin', name: 'Finance' }],
  categories: [{ id: 'c-it', name: 'IT SUPPORT' }, { id: 'c-gin', name: 'GINESYS' }, { id: 'c-unused', name: 'UNUSED' }],
  subCategories: [
    { id: 'sc-barcode', name: 'BARCODE PRINTER ISSUE', category_id: 'c-it', category_name: 'IT SUPPORT' },
    { id: 'sc-mouse', name: 'MOUSE ISSUE', category_id: 'c-it', category_name: 'IT SUPPORT' },
    { id: 'sc-invoice', name: 'INVOICE', category_id: 'c-gin', category_name: 'GINESYS' },
    { id: 'sc-orphan', name: 'ORPHAN', category_id: 'c-unused', category_name: 'UNUSED' },
  ],
  tags: [
    { service_id: 's-it', sub_category_id: 'sc-barcode' },
    { service_id: 's-it', sub_category_id: 'sc-mouse' },
    { service_id: 's-it', sub_category_id: 'sc-invoice' },
    { service_id: 's-fin', sub_category_id: 'sc-invoice' },
  ],
}

describe('linked Service / Category / Sub Category filters', () => {
  it('with nothing chosen offers everything', () => {
    const s = scopeTaxonomy(tx, {})
    expect(s.categories.map((c) => c.id)).toEqual(['c-it', 'c-gin', 'c-unused'])
    expect(s.subCategories).toHaveLength(4)
  })

  it('a chosen service offers only its own categories and sub categories', () => {
    const s = scopeTaxonomy(tx, { service: 's-fin' })
    expect(s.categories.map((c) => c.id)).toEqual(['c-gin'])
    expect(s.subCategories.map((x) => x.id)).toEqual(['sc-invoice'])
  })

  it('a chosen category offers only its own sub categories', () => {
    const s = scopeTaxonomy(tx, { service: 's-it', category: 'c-it' })
    expect(s.subCategories.map((x) => x.id)).toEqual(['sc-barcode', 'sc-mouse'])
  })

  it('a category that does not fit the service is dropped, and so is the sub category under it', () => {
    const s = scopeTaxonomy(tx, { service: 's-fin', category: 'c-it', subcategory: 'sc-barcode' })
    expect(s.effective).toEqual({ service: 's-fin', category: undefined, subcategory: undefined })
  })

  it('a sub category of another category is dropped, a fitting one is kept', () => {
    expect(scopeTaxonomy(tx, { category: 'c-it', subcategory: 'sc-invoice' }).effective.subcategory).toBeUndefined()
    expect(scopeTaxonomy(tx, { category: 'c-it', subcategory: 'sc-mouse' }).effective.subcategory).toBe('sc-mouse')
  })

  it('an unknown service id is ignored', () => {
    expect(scopeTaxonomy(tx, { service: 'nope' }).effective.service).toBeUndefined()
  })

  it('a service with no sub categories offers no categories', () => {
    const s = scopeTaxonomy({ ...tx, services: [...tx.services, { id: 's-empty', name: 'Empty' }] }, { service: 's-empty' })
    expect(s.categories).toEqual([])
    expect(s.subCategories).toEqual([])
  })
})
