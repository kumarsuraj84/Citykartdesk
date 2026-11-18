// A field limited to some SUB-categories (for example the carry-bag details only for "Carry bag updation" under "Ginesys Issues"). Same idea as the category limit,
// one level down: shown to the requester only after choosing it, mandatory only then, hidden on the ticket when a technician moves it elsewhere (the saved value is kept).
import { describe, it, expect } from 'vitest'
import { fieldAppliesToSubCategory, fieldAppliesToTicket, filterSectionsForCategory } from '@/lib/forms/sections'
import { validateRequesterFormCompletion } from '@/lib/requests/validate-requester-form-completion'
import { requiredFileLabels } from '@/lib/attachments/required-files'
import type { FormField, FormSection } from '@/types'

const text = (id: string, extra: Partial<FormField> = {}): FormField => ({ id, type: 'text', label: id, required: false, order: 0, ...extra })
const GINESYS = 'cat-ginesys', CARRY = 'sub-carry-bag', OTHER_SUB = 'sub-user-id', HARDWARE = 'cat-hardware'
const bagSize = text('bag_size', { label: 'Bag size', required: true, show_for_sub_categories: [CARRY] })
const bagQty = text('bag_qty', { label: 'Bag quantity', show_for_sub_categories: [CARRY, 'sub-other-bag'] })
const sections: FormSection[] = [{ id: 's1', title: 'Details', order: 0, fields: [text('subject', { label: 'Subject', required: true }), bagSize, bagQty] }]

describe('the sub-category limit of a field', () => {
  it('applies only when the sub-category is one of the listed ones (none chosen = does not apply)', () => {
    expect(fieldAppliesToSubCategory(bagSize, CARRY)).toBe(true)
    expect(fieldAppliesToSubCategory(bagSize, OTHER_SUB)).toBe(false)
    expect(fieldAppliesToSubCategory(bagSize, null)).toBe(false)
    expect(fieldAppliesToSubCategory(bagQty, 'sub-other-bag')).toBe(true)
  })
  it('an ordinary field (no list or an empty list) applies to every sub-category', () => {
    expect(fieldAppliesToSubCategory(text('a'), 'x')).toBe(true)
    expect(fieldAppliesToSubCategory(text('a'), null)).toBe(true)
    expect(fieldAppliesToSubCategory(text('a', { show_for_sub_categories: [] }), 'x')).toBe(true)
  })
  it('with both limits the category AND the sub-category must match', () => {
    const both = text('both', { show_for_categories: [GINESYS], show_for_sub_categories: [CARRY] })
    expect(fieldAppliesToTicket(both, GINESYS, CARRY)).toBe(true)
    expect(fieldAppliesToTicket(both, HARDWARE, CARRY)).toBe(false)
    expect(fieldAppliesToTicket(both, GINESYS, OTHER_SUB)).toBe(false)
    expect(fieldAppliesToTicket(text('plain'), null, null)).toBe(true)
  })
  it('a category limit alone still behaves as before', () => {
    const catOnly = text('c', { show_for_categories: [GINESYS] })
    expect(fieldAppliesToTicket(catOnly, GINESYS, 'anything')).toBe(true)
    expect(fieldAppliesToTicket(catOnly, GINESYS, null)).toBe(true)
    expect(fieldAppliesToTicket(catOnly, HARDWARE, 'anything')).toBe(false)
  })
})

describe('what the screens show', () => {
  const ids = (cat: string | null, sub: string | null) => filterSectionsForCategory(sections, cat, sub).flatMap((s) => s.fields.map((f) => f.id))
  it('the requester sees the carry-bag fields only after choosing Carry bag updation', () => {
    expect(ids(null, null)).toEqual(['subject'])
    expect(ids(GINESYS, OTHER_SUB)).toEqual(['subject'])
    expect(ids(GINESYS, CARRY)).toEqual(['subject', 'bag_size', 'bag_qty'])
  })
  it('on a ticket, moving it to another sub-category hides them, and back shows them again', () => {
    const data = { subject: 'x', bag_size: 'Large', bag_qty: 40 }
    const visible = (sub: string) => ids(GINESYS, sub).filter((id) => id in data)
    expect(visible(CARRY)).toEqual(['subject', 'bag_size', 'bag_qty'])
    expect(visible(OTHER_SUB)).toEqual(['subject'])      // hidden (the values in `data` are not touched: nothing here deletes them)
    expect(visible(CARRY)).toEqual(['subject', 'bag_size', 'bag_qty'])
    expect(data).toEqual({ subject: 'x', bag_size: 'Large', bag_qty: 40 })
  })
})

describe('server-side checks use the same rule', () => {
  const service = { form_sections: sections }
  it('Bag size is mandatory for Carry bag updation and not asked for another sub-category', () => {
    const missing = validateRequesterFormCompletion({ service, formData: { subject: 'x' }, categoryId: GINESYS, subCategoryId: CARRY })
    expect(missing.valid).toBe(false)
    expect(missing.missingFields.map((m) => m.label)).toEqual(['Bag size'])
    expect(validateRequesterFormCompletion({ service, formData: { subject: 'x', bag_size: 'Large' }, categoryId: GINESYS, subCategoryId: CARRY }).valid).toBe(true)
    expect(validateRequesterFormCompletion({ service, formData: { subject: 'x' }, categoryId: GINESYS, subCategoryId: OTHER_SUB }).valid).toBe(true)
    expect(validateRequesterFormCompletion({ service, formData: { subject: 'x' } }).valid).toBe(true)
  })
  it('a required FILE field limited to a sub-category is only expected for that sub-category', () => {
    const file = text('proof', { type: 'file', label: 'Proof', required: true, show_for_sub_categories: [CARRY] })
    const snap = [{ id: 's', title: 't', order: 0, fields: [file] }]
    expect(requiredFileLabels({ form_sections_snapshot: snap, category_id: GINESYS, sub_category_id: CARRY })).toEqual(['Proof'])
    expect(requiredFileLabels({ form_sections_snapshot: snap, category_id: GINESYS, sub_category_id: OTHER_SUB })).toEqual([])
  })
})
