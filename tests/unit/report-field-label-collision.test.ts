import { describe, it, expect } from 'vitest'
import { getEntityFields } from '@/lib/reporting/field-registry'

describe('getEntityFields — custom field label collisions with built-in fields', () => {
  it('disambiguates a custom field whose name collides with a built-in field label', () => {
    const fields = getEntityFields('requests', [
      { key: 'form:abc123', label: 'Description', type: 'string' },
    ])
    const descriptionFields = fields.filter((f) => f.label.toLowerCase().startsWith('description'))
    expect(descriptionFields).toHaveLength(2)
    expect(descriptionFields.map((f) => f.label).sort()).toEqual(['Description', 'Description (Custom Field)'])
    // The built-in one is untouched — same key, same label.
    expect(fields.find((f) => f.key === 'description')?.label).toBe('Description')
  })

  it('is case-insensitive when detecting a collision', () => {
    const fields = getEntityFields('requests', [
      { key: 'form:xyz', label: 'description', type: 'string' },
    ])
    expect(fields.find((f) => f.key === 'form:xyz')?.label).toBe('description (Custom Field)')
  })

  it('leaves a non-colliding custom field label untouched', () => {
    const fields = getEntityFields('requests', [
      { key: 'form:def', label: 'AC Serial Number', type: 'string' },
    ])
    expect(fields.find((f) => f.key === 'form:def')?.label).toBe('AC Serial Number')
  })
})
