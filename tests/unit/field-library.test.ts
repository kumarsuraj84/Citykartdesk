import { describe, expect, it } from 'vitest'
import {
  applyLibraryDefinition,
  fieldFromLibrary,
  findDuplicateGroups,
  libraryUsage,
  syncSectionsWithLibrary,
  type LibraryFieldDef,
} from '@/lib/forms/library'
import type { FormField, FormSection } from '@/types'

const contact: LibraryFieldDef = {
  id: 'lib-contact', label: 'Contact Number', type: 'phone', placeholder: '10 digits', help_text: null, options: null,
}

const field = (over: Partial<FormField>): FormField => ({
  id: 'f1', type: 'text', label: 'x', required: false, order: 0, ...over,
})
const section = (fields: FormField[]): FormSection => ({ id: 's', title: 'S', order: 0, fields })
const template = (id: string, fields: FormField[]) => ({ id, name: `T-${id}`, form_sections: [section(fields)] })

describe('applyLibraryDefinition', () => {
  it('copies the definition but keeps per-template settings', () => {
    const out = applyLibraryDefinition(
      field({ id: 'inst', label: 'old', type: 'text', required: true, requester_can_view: false, semantic_role: 'request_title' }),
      contact
    )
    expect(out).toMatchObject({
      id: 'inst', label: 'Contact Number', type: 'phone', placeholder: '10 digits',
      library_field_id: 'lib-contact', required: true, requester_can_view: false, semantic_role: 'request_title',
    })
  })

  it('fieldFromLibrary builds a fully requester-facing, optional field', () => {
    expect(fieldFromLibrary(contact, 'new-id')).toMatchObject({
      id: 'new-id', required: false, requester_can_view: true, requester_can_set: true, library_field_id: 'lib-contact',
    })
  })
})

describe('syncSectionsWithLibrary', () => {
  it('propagates an edited library definition and reports a change', () => {
    const linked = applyLibraryDefinition(field({ id: 'a' }), contact)
    const edited = { ...contact, label: 'Mobile Number' }
    const { sections, changed } = syncSectionsWithLibrary([section([linked])], new Map([[edited.id, edited]]))
    expect(changed).toBe(true)
    expect(sections[0].fields[0].label).toBe('Mobile Number')
  })

  it('reports no change when already in sync', () => {
    const linked = applyLibraryDefinition(field({ id: 'a' }), contact)
    expect(syncSectionsWithLibrary([section([linked])], new Map([[contact.id, contact]])).changed).toBe(false)
  })

  it('unlinks (keeps) a field whose library entry no longer exists', () => {
    const linked = applyLibraryDefinition(field({ id: 'a' }), contact)
    const { sections, changed } = syncSectionsWithLibrary([section([linked])], new Map())
    expect(changed).toBe(true)
    expect(sections[0].fields[0].library_field_id).toBeUndefined()
    expect(sections[0].fields[0].label).toBe('Contact Number')
  })

  it('leaves unlinked fields alone', () => {
    const plain = field({ id: 'p', label: 'Keep me' })
    const { sections, changed } = syncSectionsWithLibrary([section([plain])], new Map([[contact.id, contact]]))
    expect(changed).toBe(false)
    expect(sections[0].fields[0]).toEqual(plain)
  })
})

describe('findDuplicateGroups', () => {
  it('groups same name + type across templates, ignoring case and spacing', () => {
    const groups = findDuplicateGroups(
      [
        template('1', [field({ id: 'a', label: 'Contact Number', type: 'phone' })]),
        template('2', [field({ id: 'b', label: '  contact   number ', type: 'phone' })]),
      ],
      []
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].instances.map((i) => i.fieldId).sort()).toEqual(['a', 'b'])
    expect(groups[0].linkable).toBe(true)
  })

  it('does not group same name with different types, or a lone field', () => {
    const groups = findDuplicateGroups(
      [
        template('1', [field({ id: 'a', label: 'Ref', type: 'text' }), field({ id: 'c', label: 'Solo', type: 'text' })]),
        template('2', [field({ id: 'b', label: 'Ref', type: 'number' })]),
      ],
      []
    )
    expect(groups).toHaveLength(0)
  })

  it('skips fields already linked to the library', () => {
    const linked = applyLibraryDefinition(field({ id: 'a' }), contact)
    const groups = findDuplicateGroups(
      [template('1', [linked]), template('2', [field({ id: 'b', label: 'Contact Number', type: 'phone' })])],
      [contact]
    )
    // Only one unlinked instance left, but it matches an existing library field by name → offered for linking.
    expect(groups).toHaveLength(1)
    expect(groups[0].existingLibraryId).toBe('lib-contact')
    expect(groups[0].instances).toHaveLength(1)
  })

  it('refuses to link dropdowns whose choices differ', () => {
    const opt = (v: string, l: string) => ({ value: v, label: l })
    const groups = findDuplicateGroups(
      [
        template('1', [field({ id: 'a', label: 'Mode', type: 'select', options: [opt('1', 'Air')] })]),
        template('2', [field({ id: 'b', label: 'Mode', type: 'select', options: [opt('9', 'Road')] })]),
      ],
      []
    )
    expect(groups[0].linkable).toBe(false)
    expect(groups[0].reason).toMatch(/choices differ/i)
  })

  it('allows linking dropdowns with identical choices', () => {
    const opts = [{ value: '1', label: 'Air' }, { value: '2', label: 'Road' }]
    const groups = findDuplicateGroups(
      [
        template('1', [field({ id: 'a', label: 'Mode', type: 'select', options: opts })]),
        template('2', [field({ id: 'b', label: 'Mode', type: 'select', options: opts })]),
      ],
      []
    )
    expect(groups[0].linkable).toBe(true)
  })

  it('refuses when a library field of the same name has a different type', () => {
    const groups = findDuplicateGroups(
      [template('1', [field({ id: 'a', label: 'Contact Number', type: 'text' })]), template('2', [field({ id: 'b', label: 'Contact Number', type: 'text' })])],
      [contact]
    )
    expect(groups[0].linkable).toBe(false)
  })
})

describe('libraryUsage', () => {
  it('lists the templates each library field is used in', () => {
    const linked = applyLibraryDefinition(field({ id: 'a' }), contact)
    const usage = libraryUsage([template('1', [linked]), template('2', [{ ...linked, id: 'b' }]), template('3', [field({ id: 'c' })])])
    expect(usage.get('lib-contact')).toEqual(['T-1', 'T-2'])
  })
})
