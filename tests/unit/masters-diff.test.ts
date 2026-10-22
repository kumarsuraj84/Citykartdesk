import { describe, it, expect } from 'vitest'
import { matchAcUnits, matchGensets, planRemovals } from '@/lib/masters/diff'
import type { AcRow, GensetRow } from '@/lib/masters/types'

const acRow = (storeCode: string, ckdeskNo: string, serial: string, sheetRow = 2): AcRow => ({
  sheetRow, storeCode, ckdeskNo, serial, floor: '', acType: '', tonnage: '', brand: '', amcVendor: '', amcBrand: '', zenatix: '', storePriority: '', festival: '',
  region: '', cluster: '', openingDate: null, city: '', state: '', address: '', pincode: '', isActive: true, emails: [], poEmails: [],
})
const unit = (id: string, storeCode: string, ckdeskNo: string, serial: string | null, removedAt: string | null = null) => ({ id, storeCode, ckdeskNo, serial, removedAt, missingSince: null })
const gen = (storeCode: string, serial: string): GensetRow => ({ sheetRow: 2, storeCode, brand: '', kva: '', serial, cpcbGroup: '', emails: [] })
const gunit = (id: string, storeCode: string, serial: string | null, removedAt: string | null = null) => ({ id, storeCode, serial, removedAt, missingSince: null })
const ids = (m: { matches: { rowIndex: number; unitId: string }[] }) => Object.fromEntries(m.matches.map((x) => [x.rowIndex, x.unitId]))

describe('matchAcUnits', () => {
  it('an unchanged sheet matches every unit and changes nothing else', () => {
    const m = matchAcUnits([acRow('ALC', '1', 'A'), acRow('ALC', '2', 'B')], [unit('u1', 'ALC', '1', 'A'), unit('u2', 'ALC', '2', 'B')])
    expect(ids(m)).toEqual({ 0: 'u1', 1: 'u2' })
    expect(m.inserts).toEqual([])
    expect(m.unmatched).toEqual([])
  })
  it('a new row is added; rows deleted from the sheet are reported as gone', () => {
    const m = matchAcUnits([acRow('ALC', '1', 'A'), acRow('ALC', '3', 'C')], [unit('u1', 'ALC', '1', 'A'), unit('u2', 'ALC', '2', 'B')])
    expect(m.inserts).toEqual([1])
    expect(m.unmatched).toEqual(['u2'])
  })
  it('renumbering with the serials kept: the same machine keeps its history', () => {
    // the team deleted AC 2 and renumbered 3 -> 2, 4 -> 3
    const m = matchAcUnits([acRow('ALC', '1', 'A'), acRow('ALC', '2', 'C'), acRow('ALC', '3', 'D')], [unit('u1', 'ALC', '1', 'A'), unit('u2', 'ALC', '2', 'B'), unit('u3', 'ALC', '3', 'C'), unit('u4', 'ALC', '4', 'D')])
    expect(ids(m)).toEqual({ 0: 'u1', 1: 'u3', 2: 'u4' })
    expect(m.unmatched).toEqual(['u2'])
  })
  it('a corrected serial under the same number is the same AC', () => {
    const m = matchAcUnits([acRow('ALC', '2', 'B-fixed')], [unit('u2', 'ALC', '2', 'B')])
    expect(ids(m)).toEqual({ 0: 'u2' })
  })
  it('an AC without a serial is matched by its number', () => {
    const m = matchAcUnits([acRow('ALC', '5', '')], [unit('u5', 'ALC', '5', null)])
    expect(ids(m)).toEqual({ 0: 'u5' })
  })
  it('the same number in two stores is two different units', () => {
    const m = matchAcUnits([acRow('COB', '1', 'A'), acRow('PAR', '1', 'B')], [unit('c1', 'COB', '1', 'A'), unit('p1', 'PAR', '1', 'B')])
    expect(ids(m)).toEqual({ 0: 'c1', 1: 'p1' })
  })
  it('a removed AC comes back when its serial reappears', () => {
    const m = matchAcUnits([acRow('ALC', '9', 'Z')], [unit('u9', 'ALC', '9', 'Z', '2026-10-01T00:00:00Z')])
    expect(ids(m)).toEqual({ 0: 'u9' })
  })
  it('a removed AC is not revived by a reused number with a different serial: a new unit starts', () => {
    const m = matchAcUnits([acRow('ALC', '9', 'NEW')], [unit('u9', 'ALC', '9', 'OLD', '2026-10-01T00:00:00Z')])
    expect(m.matches).toEqual([])
    expect(m.inserts).toEqual([0])
  })
  it('two rows with the same number are both kept, each matched to its own unit', () => {
    const m = matchAcUnits([acRow('PAR', '3', 'X'), acRow('PAR', '3', 'Y')], [unit('a', 'PAR', '3', 'Y'), unit('b', 'PAR', '3', 'X')])
    expect(ids(m)).toEqual({ 0: 'b', 1: 'a' })
  })
})

describe('matchGensets', () => {
  it('matches by store and serial', () => {
    const m = matchGensets([gen('MCR', 'S1'), gen('MCR', 'S2')], [gunit('g1', 'MCR', 'S2'), gunit('g2', 'MCR', 'S1')])
    expect(ids(m)).toEqual({ 0: 'g2', 1: 'g1' })
  })
  it('a store with one genset whose serial was corrected keeps its genset', () => {
    const m = matchGensets([gen('DPT', 'E412CBP434664G')], [gunit('g1', 'DPT', 'E412CBРЕ434664G')])
    expect(ids(m)).toEqual({ 0: 'g1' })
    expect(m.unmatched).toEqual([])
  })
  it('a store with two gensets whose serial changed is one gone and one new (it is reported)', () => {
    const m = matchGensets([gen('MCR', 'S1'), gen('MCR', 'S9')], [gunit('g1', 'MCR', 'S1'), gunit('g2', 'MCR', 'S2')])
    expect(ids(m)).toEqual({ 0: 'g1' })
    expect(m.inserts).toEqual([1])
    expect(m.unmatched).toEqual(['g2'])
  })
  it('a genset that left the sheet is reported as gone', () => {
    const m = matchGensets([], [gunit('g1', 'MCR', 'S1')])
    expect(m.unmatched).toEqual(['g1'])
  })
})

describe('planRemovals (big deletions wait)', () => {
  const now = new Date('2026-10-19T10:00:00Z')
  const miss = (n: number, since: string | null = null) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, missingSince: since }))
  it('a few units are removed at once', () => {
    const p = planRemovals({ missing: miss(2), currentTotal: 100, now })
    expect(p.removeNow).toHaveLength(2)
    expect(p.bigChange).toBe(false)
  })
  it('more than 20 units at once wait', () => {
    const p = planRemovals({ missing: miss(21), currentTotal: 1000, now })
    expect(p.bigChange).toBe(true)
    expect(p.removeNow).toEqual([])
    expect(p.markMissing).toHaveLength(21)
  })
  it('more than 15 percent of the units (five or more) wait', () => {
    expect(planRemovals({ missing: miss(5), currentTotal: 30, now }).bigChange).toBe(true)
    expect(planRemovals({ missing: miss(5), currentTotal: 100, now }).bigChange).toBe(false)
  })
  it('a waiting unit is removed once it has been missing for 30 minutes', () => {
    const p = planRemovals({ missing: miss(21, '2026-10-19T09:20:00Z'), currentTotal: 1000, now })
    expect(p.removeNow).toHaveLength(21)
    const early = planRemovals({ missing: miss(21, '2026-10-19T09:45:00Z'), currentTotal: 1000, now })
    expect(early.removeNow).toEqual([])
  })
})
