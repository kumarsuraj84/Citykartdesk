/** Stage 3, Step 16 — buildCreateRequestInputFromDraft(): produces a
 *  createRequestCore()-compatible params object. Pure, no DB, no client. */
import { describe, it, expect } from 'vitest'
import type { FormField } from '@/types'
import { createEmptyDraft } from '@/lib/requests/questionnaire/types'
import { buildCreateRequestInputFromDraft } from '@/lib/requests/questionnaire/adapter'

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'type' | 'label'>): FormField {
  return { required: false, order: 0, ...overrides }
}

function serviceWith(fields: FormField[]) {
  return { form_sections: [{ id: 's1', title: 'Section', order: 0, fields }] }
}

describe('buildCreateRequestInputFromDraft()', () => {
  it('rejects a draft with no service selected', () => {
    const draft = createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' })
    const result = buildCreateRequestInputFromDraft({ draft, service: serviceWith([]), source: 'whatsapp' })
    expect(result).toEqual({ ok: false, error: 'No service selected.' })
  })

  it('TEST 3: description always maps to the description passthrough, NEVER into formData — even when a textarea field exists', () => {
    const svc = serviceWith([field({ id: 'desc', type: 'textarea', label: 'Business Justification' })])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1', description: 'Billing counter printer is not printing.' }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.description).toBe('Billing counter printer is not printing.')
    expect(result.input.formData).toEqual({}) // the textarea field is NOT auto-filled
    expect(result.input.formData?.desc).toBeUndefined()
  })

  it('description is still carried through when the form has no textarea field at all', () => {
    const svc = serviceWith([field({ id: 'subject', type: 'text', label: 'Subject' })])
    const draft = {
      ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }),
      serviceId: 'svc-1', description: 'AC not cooling', answers: { subject: 'AC issue' },
    }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.formData).toEqual({ subject: 'AC issue' })
    expect(result.input.description).toBe('AC not cooling')
  })

  it('TEST 4: draft.title maps to the trusted titleOverride param, exactly, with no modification', () => {
    const svc = serviceWith([])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1', title: 'Billing Counter Printer Not Printing' }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.titleOverride).toBe('Billing Counter Printer Not Printing')
  })

  it('draft.title = null leaves titleOverride undefined (falls back to createRequestCore()\'s own derivation)', () => {
    const svc = serviceWith([])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1' }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.titleOverride).toBeUndefined()
  })

  it('description, title and answers map independently — no cross-contamination', () => {
    const svc = serviceWith([field({ id: 'subject', type: 'text', label: 'Subject' })])
    const draft = {
      ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }),
      serviceId: 'svc-1',
      description: 'Billing counter printer is not printing.',
      title: 'Billing Counter Printer Not Printing',
      answers: { subject: 'Printer issue' },
    }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.description).toBe('Billing counter printer is not printing.')
    expect(result.input.titleOverride).toBe('Billing Counter Printer Not Printing')
    expect(result.input.formData).toEqual({ subject: 'Printer issue' })
  })

  it('never sets priorityOverride or teamIdOverride', () => {
    const svc = serviceWith([])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1' }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect('priorityOverride' in result.input).toBe(false)
    expect('teamIdOverride' in result.input).toBe(false)
  })

  it('sets actingUserId to the requester (self-serve, never "on behalf of") and forces admin writes', () => {
    const svc = serviceWith([])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1' }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.requesterId).toBe('user-1')
    expect(result.input.actingUserId).toBe('user-1')
    expect(result.input.useAdminForWrites).toBe(true)
    expect(result.input.orgId).toBe('org-1')
    expect(result.input.serviceId).toBe('svc-1')
    expect(result.input.source).toBe('whatsapp')
  })

  it('passes subCategoryId through from the draft', () => {
    const svc = serviceWith([])
    const draft = { ...createEmptyDraft({ orgId: 'org-1', requesterId: 'user-1' }), serviceId: 'svc-1', subCategoryId: 'sub-1' }
    const result = buildCreateRequestInputFromDraft({ draft, service: svc, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.input.subCategoryId).toBe('sub-1')
  })
})
