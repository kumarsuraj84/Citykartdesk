import { describe, it, expect } from 'vitest'
import { countBy, distinct, exportRows, filterFleet, stateOf, type AcMasterRow } from '@/lib/masters/fleet'

const ac = (o: Partial<AcMasterRow>): AcMasterRow => ({
  id: 'x', store_code: 'ALC', ckdesk_no: '1', serial: 'S1', floor: 'GF', ac_type: 'Split', tonnage: '2 TR', brand: 'VOLTAS', amc_vendor: 'VOLTAS', amc_brand: null,
  region: 'R6', cluster: null, city: 'Pakur', state: null, is_active: true, emails: [], removed_at: null, ...o,
})
const rows = [
  ac({ id: '1' }), ac({ id: '2', brand: 'BLUESTAR', region: 'R3', store_code: 'MAR' }),
  ac({ id: '3', is_active: false, serial: 'INACT' }), ac({ id: '4', removed_at: '2026-10-01T00:00:00Z', serial: 'GONE' }),
]

describe('AC / Genset master lists', () => {
  it('says whether a row is active, inactive or removed (removed wins)', () => {
    expect(stateOf(rows[0])).toBe('active')
    expect(stateOf(rows[2])).toBe('inactive')
    expect(stateOf(rows[3])).toBe('removed')
    expect(stateOf({ removed_at: '2026-10-01', is_active: false })).toBe('removed')
  })
  it('shows Active rows by default and filters by status, brand, region and search', () => {
    expect(filterFleet(rows, {}).map((r) => r.id)).toEqual(['1', '2'])
    expect(filterFleet(rows, { status: 'all' })).toHaveLength(4)
    expect(filterFleet(rows, { status: 'inactive' }).map((r) => r.id)).toEqual(['3'])
    expect(filterFleet(rows, { status: 'removed' }).map((r) => r.id)).toEqual(['4'])
    expect(filterFleet(rows, { brand: 'bluestar' }).map((r) => r.id)).toEqual(['2'])
    expect(filterFleet(rows, { region: 'R6' }).map((r) => r.id)).toEqual(['1'])
    expect(filterFleet(rows, { q: 'mar' }).map((r) => r.id)).toEqual(['2'])
    expect(filterFleet(rows, { status: 'all', q: 'gone' }).map((r) => r.id)).toEqual(['4'])
  })
  it('counts by a column, biggest first, blanks as (blank)', () => {
    expect(countBy([...rows, ac({ id: '5', brand: null })], (r) => r.brand)).toEqual([{ value: 'VOLTAS', count: 3 }, { value: '(blank)', count: 1 }, { value: 'BLUESTAR', count: 1 }])
    expect(distinct(rows, (r) => r.region)).toEqual(['R3', 'R6'])
  })
  it('exports the status in words and the OEM addresses in one cell', () => {
    const out = exportRows('ac', [ac({ emails: ['a@oem.test', 'b@oem.test'] }), ac({ is_active: false })])
    expect(out[0]).toMatchObject({ state_label: 'Active', mail: 'a@oem.test; b@oem.test' })
    expect(out[1]).toMatchObject({ state_label: 'Inactive', mail: '' })
  })
})
