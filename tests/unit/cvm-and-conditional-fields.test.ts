import { describe, it, expect } from 'vitest'
import { buildCvmCandidates, resolveCvm } from '@/lib/cvm/resolve'
import { fieldAppliesToCategory, filterSectionsForCategory } from '@/lib/forms/sections'
import { validateRequesterFormCompletion } from '@/lib/requests/validate-requester-form-completion'
import type { FormField, FormSection } from '@/types'

describe('resolving a CVM named in the Store Master sheet', () => {
  const staff = [{ id: 'u1', full_name: 'Ankur' }, { id: 'u2', full_name: 'Ajay' }, { id: 'u3', full_name: 'Ajay' }]
  const c = buildCvmCandidates(staff, new Map([['u1', 'Ankur@citykart.org'], ['u2', 'ajay.one@citykart.org'], ['u3', 'ajay.two@citykart.org']]))
  it('finds a person by e-mail (any capitals) or by a name only one person has', () => {
    expect(resolveCvm('ankur@citykart.org', c)).toEqual({ id: 'u1' })
    expect(resolveCvm(' ANKUR ', c)).toEqual({ id: 'u1' })
    expect(resolveCvm('ajay.two@citykart.org', c)).toEqual({ id: 'u3' })
  })
  it('refuses a name that fits two people and a person who is not active staff', () => {
    expect(resolveCvm('Ajay', c)).toMatchObject({ error: expect.stringContaining('more than one') })
    expect(resolveCvm('Someone Else', c)).toMatchObject({ error: expect.stringContaining('not an active staff member') })
    expect(resolveCvm('', c)).toEqual({ error: 'empty' })
  })
})

const text = (id: string, extra: Partial<FormField> = {}): FormField => ({ id, type: 'text', label: id, required: false, order: 0, ...extra })
const qty = text('qty', { type: 'number', label: 'Qty', required: true, show_for_categories: ['cat-fixture', 'cat-hanger'] })
const sections: FormSection[] = [{ id: 's1', title: 'Details', order: 0, fields: [text('subject', { label: 'Subject', required: true }), qty] }]

describe('a field limited to some categories', () => {
  it('applies only when the category is one of them (no category chosen = does not apply)', () => {
    expect(fieldAppliesToCategory(qty, 'cat-fixture')).toBe(true)
    expect(fieldAppliesToCategory(qty, 'cat-hanger')).toBe(true)
    expect(fieldAppliesToCategory(qty, 'cat-paint')).toBe(false)
    expect(fieldAppliesToCategory(qty, null)).toBe(false)
  })
  it('an ordinary field (no list, or an empty list) applies to every category', () => {
    expect(fieldAppliesToCategory(text('a'), 'x')).toBe(true)
    expect(fieldAppliesToCategory(text('a'), null)).toBe(true)
    expect(fieldAppliesToCategory(text('a', { show_for_categories: [] }), 'x')).toBe(true)
  })
  it('the form shows Qty only after a matching category is chosen', () => {
    const ids = (cat: string | null) => filterSectionsForCategory(sections, cat).flatMap((s) => s.fields.map((f) => f.id))
    expect(ids(null)).toEqual(['subject'])
    expect(ids('cat-paint')).toEqual(['subject'])
    expect(ids('cat-fixture')).toEqual(['subject', 'qty'])
  })
  it('Qty is mandatory for a fixture ticket and not asked for any other ticket (server-side check)', () => {
    const service = { form_sections: sections }
    const fixtureMissing = validateRequesterFormCompletion({ service, formData: { subject: 'Need fixtures' }, categoryId: 'cat-fixture' })
    expect(fixtureMissing.valid).toBe(false)
    expect(fixtureMissing.missingFields.map((m) => m.label)).toEqual(['Qty'])
    const fixtureOk = validateRequesterFormCompletion({ service, formData: { subject: 'Need fixtures', qty: 12 }, categoryId: 'cat-fixture' })
    expect(fixtureOk.valid).toBe(true)
    const paint = validateRequesterFormCompletion({ service, formData: { subject: 'Paint the wall' }, categoryId: 'cat-paint' })
    expect(paint.valid).toBe(true)
    const noCategory = validateRequesterFormCompletion({ service, formData: { subject: 'x' } })
    expect(noCategory.valid).toBe(true)
  })
})
