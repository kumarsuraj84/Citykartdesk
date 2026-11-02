import { describe, it, expect } from 'vitest'
import { missingDetails, missingSummary, missingLabel } from '@/lib/stores/missing'

const full = { is_active: true, address: 'Main Road', pincode: '229001', city: 'RAIBARELI', state: 'UP', region: 'R5', cluster: 'UP5', priority_list: 'ROS', festival: 'Diwali', open_date: '2024-03-12' }

describe('the missing details of a store card', () => {
  it('a complete store misses nothing', () => {
    expect(missingDetails(full)).toEqual([])
  })
  it('lists the blank details in the shown order; empty text and spaces count as blank', () => {
    expect(missingDetails({ ...full, pincode: null, open_date: null })).toEqual(['pincode', 'open_date'])
    expect(missingDetails({ ...full, region: '', cluster: '   ' })).toEqual(['region', 'cluster'])
    expect(missingDetails({ is_active: true })).toHaveLength(9)
  })
  it('an inactive store is never reported', () => {
    expect(missingDetails({ ...full, is_active: false, pincode: null })).toEqual([])
  })
  it('counts the stores with a gap and the stores missing each detail', () => {
    const s = missingSummary([full, { ...full, pincode: null, open_date: null }, { ...full, pincode: null, region: null, cluster: null }, { ...full, is_active: false, city: null }])
    expect(s.stores).toBe(2)
    expect(s.perField.map((p) => [p.key, p.count])).toEqual([['pincode', 2], ['region', 1], ['cluster', 1], ['open_date', 1]])
  })
  it('a list with nothing missing has an empty summary', () => {
    expect(missingSummary([full, full])).toEqual({ stores: 0, perField: [] })
    expect(missingSummary([])).toEqual({ stores: 0, perField: [] })
  })
  it('has a readable name for each detail', () => {
    expect(missingLabel('open_date')).toBe('Open date')
    expect(missingLabel('priority_list')).toBe('Priority list')
  })
})
