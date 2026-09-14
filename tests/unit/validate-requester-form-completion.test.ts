/**
 * Stage 1C — validateRequesterFormCompletion() is the shared mandatory-field
 * completion gate every ticket-creation channel (web, Email Intake, and
 * eventually WhatsApp) must pass before createRequestCore() will insert a
 * request. Pure function, no DB — see tests/integration/
 * whatsapp-stage1-create-request-core.test.ts for the end-to-end (real
 * insert) proof that createRequestCore() actually enforces this.
 */
import { describe, it, expect } from 'vitest'
import { validateRequesterFormCompletion } from '@/lib/requests/validate-requester-form-completion'
import type { FormField } from '@/types'

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'type' | 'label'>): FormField {
  return { required: false, order: 0, ...overrides }
}

function serviceWith(fields: FormField[]) {
  return { form_sections: [{ id: 's1', title: 'Section', order: 0, fields }] }
}

describe('validateRequesterFormCompletion()', () => {
  it('required text missing → rejected as missing', () => {
    const svc = serviceWith([field({ id: 'name', type: 'text', label: 'Full Name', required: true })])
    const result = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(result.valid).toBe(false)
    expect(result.missingFields).toEqual([{ key: 'name', label: 'Full Name' }])
    expect(result.invalidFields).toEqual([])
  })

  it('required select missing → rejected as missing', () => {
    const svc = serviceWith([
      field({ id: 'issue_type', type: 'select', label: 'Issue Type', required: true, options: [{ value: 'a', label: 'A' }] }),
    ])
    const result = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(result.valid).toBe(false)
    expect(result.missingFields.map((f) => f.key)).toEqual(['issue_type'])
  })

  it('required multiselect missing (empty array counts as empty) → rejected as missing', () => {
    const svc = serviceWith([field({ id: 'tags', type: 'multiselect', label: 'Tags', required: true })])
    const result = validateRequesterFormCompletion({ service: svc, formData: { tags: [] } })
    expect(result.valid).toBe(false)
    expect(result.missingFields.map((f) => f.key)).toEqual(['tags'])
  })

  it('required date missing → rejected as missing', () => {
    const svc = serviceWith([field({ id: 'since_when', type: 'date', label: 'Since When', required: true })])
    const result = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(result.missingFields.map((f) => f.key)).toEqual(['since_when'])
  })

  it('required email missing → rejected as missing; present but malformed → rejected as invalid, not missing', () => {
    const svc = serviceWith([field({ id: 'email', type: 'email', label: 'Email', required: true })])
    const missing = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(missing.missingFields.map((f) => f.key)).toEqual(['email'])

    const invalid = validateRequesterFormCompletion({ service: svc, formData: { email: 'not-an-email' } })
    expect(invalid.valid).toBe(false)
    expect(invalid.missingFields).toEqual([])
    expect(invalid.invalidFields).toHaveLength(1)
    expect(invalid.invalidFields[0].key).toBe('email')
  })

  it('required phone missing → rejected as missing; present but malformed → rejected as invalid', () => {
    const svc = serviceWith([field({ id: 'phone', type: 'phone', label: 'Phone', required: true })])
    const missing = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(missing.missingFields.map((f) => f.key)).toEqual(['phone'])

    const invalid = validateRequesterFormCompletion({ service: svc, formData: { phone: '12345' } })
    expect(invalid.invalidFields.map((f) => f.key)).toEqual(['phone'])
  })

  it('required number: missing → missing; non-numeric / out of range → invalid', () => {
    const svc = serviceWith([
      field({ id: 'qty', type: 'number', label: 'Quantity', required: true, validation: { min: 1, max: 5 } }),
    ])
    expect(validateRequesterFormCompletion({ service: svc, formData: {} }).missingFields.map((f) => f.key)).toEqual(['qty'])
    expect(validateRequesterFormCompletion({ service: svc, formData: { qty: 'abc' } }).invalidFields.map((f) => f.key)).toEqual(['qty'])
    expect(validateRequesterFormCompletion({ service: svc, formData: { qty: 10 } }).invalidFields.map((f) => f.key)).toEqual(['qty'])
    expect(validateRequesterFormCompletion({ service: svc, formData: { qty: 3 } }).valid).toBe(true)
  })

  it('required toggle answered false is VALID (Stage 7.1 F-02 fix) — only a genuinely missing value is rejected', () => {
    const svc = serviceWith([field({ id: 'consent', type: 'toggle', label: 'Consent', required: true })])
    expect(validateRequesterFormCompletion({ service: svc, formData: { consent: false } }).valid).toBe(true)
    expect(validateRequesterFormCompletion({ service: svc, formData: { consent: true } }).valid).toBe(true)
    const missing = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(missing.missingFields.map((f) => f.key)).toEqual(['consent'])
  })

  it('required store_address — always exempt (system-populated), even when empty', () => {
    const svc = serviceWith([field({ id: 'addr', type: 'store_address', label: 'Store Address', required: true })])
    const result = validateRequesterFormCompletion({ service: svc, formData: { addr: '' } })
    expect(result.valid).toBe(true)
  })

  it('required file: treated as satisfied by default (client-side-only enforcement, matches createRequest()'
    + ' today); flagged as missing in strict mode', () => {
    const svc = serviceWith([field({ id: 'photo', type: 'file', label: 'Photo', required: true })])
    const lenient = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(lenient.valid).toBe(true)

    const strict = validateRequesterFormCompletion({ service: svc, formData: {}, treatFileFieldsAsSatisfied: false })
    expect(strict.valid).toBe(false)
    expect(strict.missingFields.map((f) => f.key)).toEqual(['photo'])
  })

  it('all mandatory fields present and valid → valid', () => {
    const svc = serviceWith([
      field({ id: 'name', type: 'text', label: 'Name', required: true }),
      field({ id: 'notes', type: 'textarea', label: 'Notes', required: false }),
    ])
    const result = validateRequesterFormCompletion({ service: svc, formData: { name: 'Rahul' } })
    expect(result.valid).toBe(true)
    expect(result.missingFields).toEqual([])
    expect(result.invalidFields).toEqual([])
  })

  it('optional field missing → allowed', () => {
    const svc = serviceWith([field({ id: 'notes', type: 'textarea', label: 'Notes', required: false })])
    expect(validateRequesterFormCompletion({ service: svc, formData: {} }).valid).toBe(true)
  })

  it('requester-invisible required field missing → allowed (technician-mandatory instead, not this gate\'s job)', () => {
    const svc = serviceWith([
      field({ id: 'internal_note', type: 'text', label: 'Internal Note', required: true, requester_can_view: false }),
    ])
    const result = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(result.valid).toBe(true)
    expect(result.requesterFields).toEqual([]) // filtered out entirely, per filterFlatFieldsForRequester
    expect(result.allFields).toHaveLength(1) // still present in the unfiltered list
  })

  it('requester-visible-but-not-settable required field missing → allowed (technician-mandatory instead)', () => {
    const svc = serviceWith([
      field({ id: 'readonly', type: 'text', label: 'Readonly', required: true, requester_can_view: true, requester_can_set: false }),
    ])
    const result = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(result.valid).toBe(true)
    // Still present (visible), just not counted as requester-mandatory.
    expect(result.requesterFields.map((f) => f.id)).toEqual(['readonly'])
  })

  it('resolves a Form Template over the service\'s own fields when tagged, same precedence as resolveServiceFormSections()', () => {
    const svc = {
      form_sections: [{ id: 's1', title: 'Service Section', order: 0, fields: [field({ id: 'x', type: 'text', label: 'X', required: true })] }],
      template: { form_sections: [{ id: 't1', title: 'Template Section', order: 0, fields: [field({ id: 'y', type: 'text', label: 'Y', required: true })] }] },
    }
    const result = validateRequesterFormCompletion({ service: svc, formData: {} })
    expect(result.missingFields.map((f) => f.key)).toEqual(['y'])
  })
})
