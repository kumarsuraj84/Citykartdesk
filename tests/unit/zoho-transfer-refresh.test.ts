import { describe, it, expect } from 'vitest'
import { addMissingFieldDefinitions, formDataHas } from '@/lib/zoho/transfer/refresh-pure'
import { ZOHO_UDF_LABELS, ZOHO_UDF_IN_NAMED_COLUMN, zohoUdfLabel } from '@/lib/zoho/transfer/udf-labels'
import type { FormSection } from '@/types'

const f = (id: string, label: string) => ({ id, label, type: 'text', required: false, order: 0 }) as never
const sec = (id: string, fields: unknown[]) => ({ id, title: id, order: 0, fields }) as unknown as FormSection

describe('Zoho custom field names', () => {
  it('shows the plain Zoho name, never the code', () => {
    expect(zohoUdfLabel('udf_char3')).toBe('Contact Detail')
    expect(zohoUdfLabel('udf_char2')).toBe('Division (Apps)')
    expect(zohoUdfLabel('udf_char3')).not.toMatch(/udf/)
  })
  it('a field nobody has named is shown with its code so two of them can be told apart', () => {
    expect(zohoUdfLabel('udf_char99999')).toBe('Unnamed Zoho field (udf_char99999)')
    expect(Object.keys(ZOHO_UDF_LABELS).length).toBeGreaterThan(50)
  })
  it('a field that already has a named column is listed once; the contact detail is not hidden', () => {
    expect(ZOHO_UDF_IN_NAMED_COLUMN.has('udf_char2')).toBe(true)
    expect(ZOHO_UDF_IN_NAMED_COLUMN.has('udf_char3')).toBe(false)
  })
})

describe('filling in fields of an already moved ticket', () => {
  it('knows when a field already has a value (never overwritten)', () => {
    expect(formDataHas({ a: 'x' }, 'a')).toBe(true)
    expect(formDataHas({ a: '  ' }, 'a')).toBe(false)
    expect(formDataHas({ a: [] }, 'a')).toBe(false)
    expect(formDataHas({ a: 0 }, 'a')).toBe(true)
    expect(formDataHas(null, 'a')).toBe(false)
  })
  it('adds only the definition of the new field to the ticket\'s own form copy', () => {
    const snapshot = [sec('s1', [f('old', 'Old')])]
    const current = [sec('s1', [f('old', 'Old'), f('contact', 'Contact No')]), sec('s2', [f('other', 'Other')])]
    const out = addMissingFieldDefinitions(snapshot, current, ['contact'])
    expect(out).toHaveLength(1)
    expect((out[0].fields as { id: string }[]).map((x) => x.id)).toEqual(['old', 'contact'])
    expect((snapshot[0].fields as unknown[]).length).toBe(1) // the original is not changed
  })
  it('creates the section when the ticket\'s form copy did not have it, and skips a field it already has', () => {
    const current = [sec('s2', [f('contact', 'Contact No')])]
    const out = addMissingFieldDefinitions([sec('s1', [f('contact', 'Contact No')])], current, ['contact'])
    expect(out).toHaveLength(1)
    const out2 = addMissingFieldDefinitions([sec('s1', [f('x', 'X')])], current, ['contact'])
    expect(out2.map((s) => s.id)).toEqual(['s1', 's2'])
  })
  it('works with no form copy at all', () => {
    expect(addMissingFieldDefinitions(null, [sec('s', [f('c', 'C')])], ['c']).map((s) => s.id)).toEqual(['s'])
  })
})

describe('the search that limits the Mapping screen', () => {
  it('builds the same conditions for the same search, and none for an empty one', async () => {
    const { buildTicketWhere, hasTicketFilter } = await import('@/lib/zoho/transfer/data')
    expect(hasTicketFilter({})).toBe(false)
    expect(hasTicketFilter({ numbers: '100-133' })).toBe(true)
    const none = buildTicketWhere({}, [])
    expect(none.where).toEqual([])
    const some = buildTicketWhere({ numbers: '1, 5-9', status: 'Open', moved: 'not' }, [3, 4])
    expect(some.where.length).toBe(3)
    expect(some.p).toEqual([[1], 5, 9, 'Open', [3, 4]])
  })
})
