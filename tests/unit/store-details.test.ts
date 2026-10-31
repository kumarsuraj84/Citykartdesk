import { describe, it, expect } from 'vitest'
import { addressWithPincode, formatOpenDate, monthsSince, storeFactsFromRow, storeMailFields, loadStoreFacts, STORE_MAIL_FIELDS } from '@/lib/stores/details'

describe('the address with the pincode', () => {
  it('adds the pincode once, at the end', () => {
    expect(addressWithPincode('Main Road, Civil Lines, Allahabad', '211001')).toBe('Main Road, Civil Lines, Allahabad - 211001')
  })
  it('does not add it again when the address already has it (written with or without spaces)', () => {
    expect(addressWithPincode('Hotel Meghdoot Complex, Odisha- 768201', '768201')).toBe('Hotel Meghdoot Complex, Odisha- 768201')
    expect(addressWithPincode('Main Road, Allahabad 211 001', '211001')).toBe('Main Road, Allahabad 211 001')
  })
  it('removes a dangling comma or dash before the pincode', () => {
    expect(addressWithPincode('Main Road, Allahabad,', '211001')).toBe('Main Road, Allahabad - 211001')
    expect(addressWithPincode('Main Road, Allahabad -', '211001')).toBe('Main Road, Allahabad - 211001')
  })
  it('leaves the address alone when there is no pincode, and gives nothing when there is no address', () => {
    expect(addressWithPincode('Main Road', null)).toBe('Main Road')
    expect(addressWithPincode('Main Road', '  ')).toBe('Main Road')
    expect(addressWithPincode(null, '211001')).toBe('')
    expect(addressWithPincode('   ', '211001')).toBe('')
  })
})

describe('the opening date', () => {
  it('is written as day, month name, year', () => {
    expect(formatOpenDate('2024-03-12')).toBe('12 Mar 2024')
    expect(formatOpenDate('2011-07-01')).toBe('1 Jul 2011')
    expect(formatOpenDate(null)).toBe('')
    expect(formatOpenDate('not a date')).toBe('not a date')
  })
  it('counts whole months, and a date not reached yet is 0', () => {
    const now = new Date('2026-10-31T10:00:00Z')
    expect(monthsSince('2026-10-25', now)).toBe(0)
    expect(monthsSince('2026-02-01', now)).toBe(8)
    expect(monthsSince('2026-02-15', now)).toBe(8)   // 15 Feb -> 15 Oct is 8 months, 31 Oct is still 8
    expect(monthsSince('2026-01-31', now)).toBe(9)
    expect(monthsSince('2026-01-31', new Date('2026-10-30T10:00:00Z'))).toBe(8) // the 31st of the month is not reached yet
    expect(monthsSince('2027-01-01', now)).toBe(0)
    expect(monthsSince(null, now)).toBeNull()
    expect(monthsSince('', now)).toBeNull()
  })
})

describe('the store card as facts and as mail fields', () => {
  const row = { code: 'jhg', address: 'Hotel Meghdoot Complex', pincode: '768201', city: 'Jharsuguda', state: 'Odisha', region: 'East', cluster: 'OD-1', priority_list: 'P2', festival: 'Durga Puja', open_date: '2024-03-12' }
  it('reads every detail, trimmed, with the pincode inside the address', () => {
    const f = storeFactsFromRow({ ...row, city: '  Jharsuguda ' }, new Date('2026-10-31T00:00:00Z'))!
    expect(f).toMatchObject({ code: 'JHG', address: 'Hotel Meghdoot Complex - 768201', city: 'Jharsuguda', state: 'Odisha', region: 'East', cluster: 'OD-1', priority: 'P2', festival: 'Durga Puja', openDate: '2024-03-12', openMonths: 31 })
  })
  it('gives every mail field, empty when the store has nothing, and nothing at all for no store', () => {
    expect(Object.keys(storeMailFields(null)).sort()).toEqual([...STORE_MAIL_FIELDS].sort())
    expect(Object.values(storeMailFields(null)).every((v) => v === '')).toBe(true)
    const sparse = storeMailFields(storeFactsFromRow({ code: 'X', address: 'A', region: 'West' }))
    expect(sparse.store_region).toBe('West')
    expect(sparse.store_cluster).toBe('')
    expect(sparse.store_open_date).toBe('')
    expect(storeMailFields(storeFactsFromRow(row)).store_open_date).toBe('12 Mar 2024')
  })
  it('a missing store is null', () => {
    expect(storeFactsFromRow(null)).toBeNull()
  })
})

describe('loading the store card', () => {
  const fake = (result: unknown, seen: Array<[string, unknown]> = []) => ({
    from: () => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) q[m] = (...a: unknown[]) => { seen.push([m, a]); return q }
      q.maybeSingle = async () => result
      return q
    },
  })
  it('finds a store by its id, or by its code (capitals)', async () => {
    const seen: Array<[string, unknown]> = []
    const got = await loadStoreFacts(fake({ data: { code: 'JHG', address: 'Road', pincode: '1' }, error: null }, seen), 'org', { code: 'jhg' })
    expect(got?.address).toBe('Road - 1')
    expect(seen.some(([m, a]) => m === 'eq' && JSON.stringify(a) === JSON.stringify(['code', 'JHG']))).toBe(true)
    const byId = await loadStoreFacts(fake({ data: { code: 'JHG' }, error: null }), 'org', { id: 'abc' })
    expect(byId?.code).toBe('JHG')
  })
  it('gives null for no store, a failed read, or nothing to look for (a ticket never fails because of it)', async () => {
    expect(await loadStoreFacts(fake({ data: null, error: null }), 'org', { code: 'ZZZ' })).toBeNull()
    expect(await loadStoreFacts(fake({ data: null, error: { message: 'boom' } }), 'org', { code: 'ZZZ' })).toBeNull()
    expect(await loadStoreFacts(fake({ data: [], error: null }), 'org', { code: 'ZZZ' })).toBeNull()
    expect(await loadStoreFacts(fake({ data: {}, error: null }), 'org', {})).toBeNull()
  })
})
