import { describe, it, expect } from 'vitest'
import {
  applyStoreFilterToParams, buildStoreOptions, emptyStoreFilter, matchesStoreFilter, parseStoreFilter, storeFilterCount, storeFilterQS, toCombos,
  type StoreCombo, type StoreFilter,
} from '@/lib/analytics/store-filter'
import { storeDimsOf } from '@/lib/queries/store-dims'

const c = (region: string, state: string, cluster: string, count: number, o: Partial<StoreCombo> = {}): StoreCombo =>
  ({ region, state, cluster, stype: 'Regular', plist: 'ROS', ac: 'Within limit', count, ...o })
const combos = [
  c('North', 'Delhi', 'N1', 5), c('North', 'UP', 'N2', 3, { stype: 'NSO' }), c('West', 'Maharashtra', 'W1', 4, { ac: 'Red flag' }), c('West', '(Not set)', '(Not set)', 1),
]
const pick = (f: Partial<StoreFilter>): StoreFilter => ({ ...emptyStoreFilter(), ...f })
const values = (f: StoreFilter, k: keyof StoreFilter) => buildStoreOptions(combos, f)[k].map((o) => o.value).sort()

describe('store filter in the page address', () => {
  it('reads, writes and counts the choices', () => {
    const f = parseStoreFilter({ st_region: 'North|West', st_ac: 'Red flag', st_cluster: '', other: 'x' })
    expect(f.region).toEqual(['North', 'West'])
    expect(f.ac).toEqual(['Red flag'])
    expect(f.cluster).toEqual([])
    expect(storeFilterCount(f)).toBe(3)
    const qs = storeFilterQS(f)
    expect(qs).toBe('&st_region=North%7CWest&st_ac=Red%20flag')
    const params = new URLSearchParams('tab=requests&st_state=Delhi')
    applyStoreFilterToParams(params, f)
    expect(params.get('st_region')).toBe('North|West')
    expect(params.get('st_state')).toBeNull()
    expect(params.get('tab')).toBe('requests')
    expect(parseStoreFilter(Object.fromEntries(new URLSearchParams(qs.slice(1))))).toEqual(f)
  })

  it('ignores empty and over-long values', () => {
    expect(parseStoreFilter({ st_region: `|  |${'x'.repeat(200)}|North|North` }).region).toEqual(['North'])
  })
})

describe('store filter matching', () => {
  const d = { region: 'North', state: 'Delhi', cluster: 'N1', stype: 'Regular', plist: 'ROS', ac: 'Within limit' }
  it('passes everything when nothing is chosen and only stores matching every choice otherwise', () => {
    expect(matchesStoreFilter(d, emptyStoreFilter())).toBe(true)
    expect(matchesStoreFilter(d, pick({ region: ['North'], stype: ['Regular'] }))).toBe(true)
    expect(matchesStoreFilter(d, pick({ region: ['North'], stype: ['NSO'] }))).toBe(false)
    expect(matchesStoreFilter(d, pick({ region: ['West', 'North'] }))).toBe(true)
  })
  it('lets a requester with no store through only when nothing is chosen, and can skip one filter', () => {
    expect(matchesStoreFilter(null, emptyStoreFilter())).toBe(true)
    expect(matchesStoreFilter(null, pick({ region: ['North'] }))).toBe(false)
    expect(matchesStoreFilter(d, pick({ region: ['West'] }), 'region')).toBe(true)
  })
})

describe('linked lists of the store filter', () => {
  it('offers every value, with ticket counts, when nothing is chosen', () => {
    const o = buildStoreOptions(combos, emptyStoreFilter())
    expect(o.region.map((x) => [x.value, x.count])).toEqual([['North', 8], ['West', 5]])
    expect(o.ac.map((x) => x.value)).toEqual(['Red flag', 'Within limit'])
    // missing details are a choice too (placed last), so stores without a cluster can be found
    expect(o.cluster.at(-1)).toEqual({ value: '(Not set)', count: 1 })
  })

  it('narrows the other lists to a choice but never its own list', () => {
    const north = pick({ region: ['North'] })
    expect(values(north, 'cluster')).toEqual(['N1', 'N2'])
    expect(values(north, 'state')).toEqual(['Delhi', 'UP'])
    expect(values(north, 'ac')).toEqual(['Within limit'])
    expect(values(north, 'region')).toEqual(['North', 'West'])
  })

  it('works the other way round too', () => {
    expect(values(pick({ ac: ['Red flag'] }), 'region')).toEqual(['West'])
    expect(values(pick({ stype: ['NSO'] }), 'cluster')).toEqual(['N2'])
  })

  it('keeps a ticked value with a count of 0 when the others would hide it', () => {
    const o = buildStoreOptions(combos, pick({ region: ['North'], cluster: ['W1'] }))
    expect(o.cluster.find((x) => x.value === 'W1')?.count).toBe(0)
  })
})

describe('folding tickets into combinations', () => {
  it('counts tickets per distinct store details', () => {
    const a = { region: 'North', state: 'Delhi', cluster: 'N1', stype: 'Regular', plist: 'ROS', ac: 'Within limit' }
    const out = toCombos([a, a, { ...a, region: 'West' }])
    expect(out).toHaveLength(2)
    expect(out.find((x) => x.region === 'North')?.count).toBe(2)
  })
})

describe('a store as the filters see it', () => {
  const store = { code: 'STA', name: 'Store A', state: 'Delhi', cluster: ' UP2 ', region: null, priority_list: 'ROS', ac_total: 10, open_date: '2020-01-01' }
  const asOf = new Date(2026, 9, 12)
  it('cleans the details, marks missing ones as not set and works out store type and AC health', () => {
    const d = storeDimsOf(store, 4, asOf)
    expect(d).toMatchObject({ cluster: 'UP2', region: '(Not set)', stype: 'Regular', ac: 'Red flag', acPct: 40 })
    expect(storeDimsOf(store, 3, asOf).ac).toBe('Within limit')
    expect(storeDimsOf({ ...store, ac_total: null }, 3, asOf).ac).toBe('(No AC data)')
    expect(storeDimsOf({ ...store, open_date: '2026-08-01' }, 0, asOf).stype).toBe('NSO')
    expect(storeDimsOf({ ...store, open_date: null }, 0, asOf).stype).toBe('NSO')
  })
})
