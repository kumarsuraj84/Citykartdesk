import { describe, it, expect } from 'vitest'
import { assetKindByCategory, assetKindOfProgramName } from '@/lib/programs/asset-kind'

// The AC Calendar finds AC and Genset tickets through the Vendor Programs (the old per-category setting has no category on it any more).

describe('which program is the AC line and the Genset line', () => {
  it('knows them by name, whatever the capitals', () => {
    expect(assetKindOfProgramName('AC')).toBe('ac')
    expect(assetKindOfProgramName('ac')).toBe('ac')
    expect(assetKindOfProgramName('AC Service')).toBe('ac')
    expect(assetKindOfProgramName('Air Conditioner')).toBe('ac')
    expect(assetKindOfProgramName('GENSET')).toBe('genset')
    expect(assetKindOfProgramName('Gen set')).toBe('genset')
    expect(assetKindOfProgramName('Generator')).toBe('genset')
  })
  it('leaves the other lines out', () => {
    for (const n of ['RO PURIFIER', 'SENSOMATIC', 'Package', 'Pace', 'Space care', '', null, undefined]) expect(assetKindOfProgramName(n as string)).toBeNull()
  })
})

describe('the kind of each category', () => {
  const programs = [{ id: 'p-ac', name: 'AC' }, { id: 'p-gs', name: 'GENSET' }, { id: 'p-ro', name: 'RO PURIFIER' }]
  const cats = [
    { id: 'c1', auto_oem_kind: null, program_id: 'p-ac' },
    { id: 'c2', auto_oem_kind: null, program_id: 'p-gs' },
    { id: 'c3', auto_oem_kind: null, program_id: 'p-ro' },        // RO purifier: not AC / genset work
    { id: 'c4', auto_oem_kind: 'ac', program_id: null },          // the old setting still counts
    { id: 'c5', auto_oem_kind: null, program_id: null },         // a plain category
    { id: 'c6', auto_oem_kind: null, program_id: 'gone' },       // a program that no longer exists
  ]
  it('uses the program of the category, and the old setting where a category still has it', () => {
    const m = assetKindByCategory(cats, programs)
    expect([...m.entries()]).toEqual([['c1', 'ac'], ['c2', 'genset'], ['c4', 'ac']])
  })
})
