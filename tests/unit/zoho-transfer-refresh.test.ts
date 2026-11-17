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

describe('matching a Zoho person when two CK Desk people share a name', () => {
  const mk = (id: string, name: string, email: string) => ({ id, name, email, role: 'agent', active: true }) as never
  const a = mk('a', 'Ajay Kumar', 'ajay.kumar@citykart.org'), b = mk('b', 'Ajay Kumar', 'ajay.kumar1@citykart.org')
  const dir = { people: [a, b], byEmail: new Map([['ajay.kumar@citykart.org', a], ['ajay.kumar1@citykart.org', b]]), byName: new Map([['ajay kumar', [a, b]]]), emailsRead: true } as never
  it('the e-mail Zoho holds picks the right one', async () => {
    const { matchPerson } = await import('@/lib/zoho/transfer/data')
    expect(matchPerson(dir, new Map(), { email: 'ajay.kumar@citykart.org', name: 'Ajay Kumar' })).toMatchObject({ how: 'email', person: { id: 'a' } })
  })
  it('the name alone is never guessed between two people', async () => {
    const { matchPerson } = await import('@/lib/zoho/transfer/data')
    expect(matchPerson(dir, new Map(), { email: null, name: 'Ajay Kumar' }).how).toBe('none')
  })
  it('a hand match from the Mapping page settles it', async () => {
    const { matchPerson } = await import('@/lib/zoho/transfer/data')
    expect(matchPerson(dir, new Map([['ajay kumar', a]]), { email: null, name: 'Ajay Kumar' })).toMatchObject({ how: 'saved', person: { id: 'a' } })
  })
})

describe('a Zoho date field arrives as an object', () => {
  it('is read as the date Zoho shows, never as "[object Object]"', async () => {
    const { nameOf } = await import('@/lib/zoho/transfer/data-pure')
    expect(nameOf({ value: '1792062660000', display_value: 'Oct 15, 2026 04:41 PM' })).toBe('Oct 15, 2026 04:41 PM')
    expect(nameOf({ value: '1794288600000' })).toBe('1794288600000')
    expect(new Date(nameOf({ display_value: 'Nov 10, 2026 11:00 AM' })).getFullYear()).toBe(2026)
  })
})

describe('the warning about people CK Desk does not recognise', () => {
  const plan = (o: { reqHow?: string; reqName?: string | null; reqMail?: string | null; techName?: string | null; techHow?: string; moved?: boolean }) => ({
    requester: { name: o.reqName ?? null, email: o.reqMail ?? null, how: o.reqHow ?? 'email' },
    technician: { zohoName: o.techName ?? null, ckName: null, how: o.techHow ?? 'none' },
    problems: o.moved ? [{ code: 'already_moved', text: '' }] : [],
  }) as never
  it('lists each unmatched requester once with how many tickets, and unmatched technicians separately', async () => {
    const { unmatchedPeople } = await import('@/lib/zoho/transfer/people-warning')
    const r = unmatchedPeople([
      plan({ reqHow: 'new-inactive', reqName: 'Quality Control', techName: 'Manish Yadav' }),
      plan({ reqHow: 'new-inactive', reqName: 'quality control', techName: 'Manish Yadav' }),
      plan({ reqHow: 'new-inactive', reqName: 'NLD', techName: 'Ajay Kumar', techHow: 'email' }),
      plan({ reqHow: 'email', reqName: 'Himanshu', techName: null }),
    ])
    expect(r.requesters).toEqual([{ name: 'Quality Control', tickets: 2 }, { name: 'NLD', tickets: 1 }])
    expect(r.technicians).toEqual([{ name: 'Manish Yadav', tickets: 2 }])
  })
  it('says nothing when everybody is matched, and ignores tickets that are already moved', async () => {
    const { unmatchedPeople } = await import('@/lib/zoho/transfer/people-warning')
    expect(unmatchedPeople([plan({ reqHow: 'saved', techName: 'Ajay', techHow: 'saved' })])).toEqual({ requesters: [], technicians: [] })
    expect(unmatchedPeople([plan({ reqHow: 'new-inactive', reqName: 'NLD', techName: 'X', moved: true })])).toEqual({ requesters: [], technicians: [] })
  })
  it('a requester with only an e-mail, or nothing at all, is still named', async () => {
    const { unmatchedPeople } = await import('@/lib/zoho/transfer/people-warning')
    const r = unmatchedPeople([plan({ reqHow: 'new-inactive', reqMail: 'x@y.z' }), plan({ reqHow: 'new-inactive' })])
    expect(r.requesters.map((p) => p.name).sort()).toEqual(['(no name in Zoho)', 'x@y.z'])
  })
})
