/** Stage 3, Steps 14-15 — checkDraftReadiness() (wraps
 *  validateRequesterFormCompletion in strict file mode) and buildReviewModel()
 *  (requester-safe Review model). Pure, no DB. */
import { describe, it, expect } from 'vitest'
import type { FormField } from '@/types'
import { createEmptyDraft } from '@/lib/requests/questionnaire/types'
import { checkDraftReadiness, buildReviewModel } from '@/lib/requests/questionnaire/review'

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'type' | 'label'>): FormField {
  return { required: false, order: 0, ...overrides }
}

function serviceWith(fields: FormField[]) {
  return { id: 'svc-1', name: 'AC Repair', form_sections: [{ id: 's1', title: 'Section', order: 0, fields }] }
}

describe('checkDraftReadiness()', () => {
  it('reports not-ready while a mandatory field is missing', () => {
    const svc = serviceWith([field({ id: 'issue', type: 'select', label: 'Issue Type', required: true, options: [{ value: 'a', label: 'A' }] })])
    const result = checkDraftReadiness(svc, {})
    expect(result.valid).toBe(false)
    expect(result.missingFields.map((f) => f.key)).toEqual(['issue'])
  })

  it('runs in STRICT file mode: a required file field is never auto-satisfied', () => {
    const svc = serviceWith([field({ id: 'photo', type: 'file', label: 'Photo', required: true })])
    const result = checkDraftReadiness(svc, {}) // nothing marks the file as attached
    expect(result.valid).toBe(false)
    expect(result.missingFields.map((f) => f.key)).toEqual(['photo'])
  })

  it('reports ready once every mandatory field has a value', () => {
    const svc = serviceWith([field({ id: 'subject', type: 'text', label: 'Subject', required: true })])
    const result = checkDraftReadiness(svc, { subject: 'AC not cooling' })
    expect(result.valid).toBe(true)
  })
})

describe('buildReviewModel()', () => {
  it('excludes technician-only fields and store_address, includes only answered requester fields', () => {
    const svc = serviceWith([
      field({ id: 'subject', type: 'text', label: 'Subject', required: true }),
      field({ id: 'notes', type: 'textarea', label: 'Notes', required: false }),
      field({ id: 'addr', type: 'store_address', label: 'Store Address', required: true }),
      field({ id: 'tech', type: 'text', label: 'Tech Only', required: true, requester_can_view: false }),
    ])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1', title: 'AC Repair: AC Not Cooling', answers: { subject: 'AC not cooling', addr: '123 Main St', tech: 'internal' } }

    const model = buildReviewModel({ draft, service: svc, subCategoryName: null })

    const fieldIds = model.fields.map((f) => f.fieldId)
    expect(fieldIds).toContain('subject')
    expect(fieldIds).not.toContain('addr')
    expect(fieldIds).not.toContain('tech')
    expect(fieldIds).not.toContain('notes') // empty/unanswered, filtered out
  })

  it('formats select/radio/multiselect/checkbox values as display labels', () => {
    const svc = serviceWith([
      field({ id: 'issue', type: 'select', label: 'Issue Type', options: [{ value: 'hw', label: 'Hardware' }] }),
      field({ id: 'tags', type: 'multiselect', label: 'Tags', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
      field({ id: 'agree', type: 'checkbox', label: 'Agree' }),
    ])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1', title: 'AC Repair', answers: { issue: 'hw', tags: ['a', 'b'], agree: true } }

    const model = buildReviewModel({ draft, service: svc, subCategoryName: null })

    expect(model.fields.find((f) => f.fieldId === 'issue')?.displayValue).toBe('Hardware')
    expect(model.fields.find((f) => f.fieldId === 'tags')?.displayValue).toBe('A, B')
    expect(model.fields.find((f) => f.fieldId === 'agree')?.displayValue).toBe('Yes')
  })

  it('carries through draft.title, draft.description and sub-category display data verbatim — never regenerates', () => {
    const svc = serviceWith([])
    const draft = {
      ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }),
      serviceId: 'svc-1', subCategoryId: 'sub-1', categoryId: 'cat-1',
      description: 'It is very warm inside the store', title: 'AC Repair: Not Cooling',
    }
    const model = buildReviewModel({ draft, service: svc, subCategoryName: 'Not Cooling' })

    expect(model.serviceId).toBe('svc-1')
    expect(model.serviceName).toBe('AC Repair')
    expect(model.subCategoryId).toBe('sub-1')
    expect(model.subCategoryName).toBe('Not Cooling')
    expect(model.categoryId).toBe('cat-1')
    expect(model.description).toBe('It is very warm inside the store')
    expect(model.title).toBe('AC Repair: Not Cooling')
  })

  it('draft.description never appears in the fields list, even when a template textarea field exists', () => {
    // Stage 3.1: description and answers/form_data are independent — Review
    // must never show the description as if it were an answered template field.
    const svc = serviceWith([field({ id: 'impact', type: 'textarea', label: 'Impact Details', required: true })])
    const draft = {
      ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }),
      serviceId: 'svc-1', description: 'Internet is down.', title: 'AC Repair',
    }
    const model = buildReviewModel({ draft, service: svc, subCategoryName: null })

    expect(model.fields.some((f) => f.fieldId === 'impact')).toBe(false)
    expect(model.ready).toBe(false)
    expect(model.missingFields.map((f) => f.key)).toEqual(['impact'])
  })
})
