// The search and tick rules of the long tick lists in the form builder (over 600 sub-categories).
import { describe, it, expect } from 'vitest'
import { matchesSearch, visibleItems, groupItems, setMany, tickedNames, type PickItem } from '@/lib/forms/limit-picker'

const items: PickItem[] = [
  { id: 's1', name: 'GENISYS BACKUP ISSUE', group: 'GENISYS SUPPORT' },
  { id: 's2', name: 'CODE D ENTRY', group: 'GENISYS SUPPORT' },
  { id: 's3', name: 'CARRY BAG SMALL', group: 'CARRY BAG REQUIREMENT' },
  { id: 's4', name: 'CARRY BAG UPDATION', group: 'GENISYS SUPPORT' },
  { id: 's5', name: '0.75 MM WIRE', group: 'ELECTRICAL PROBLEM' },
]

describe('searching a long tick list', () => {
  it('finds by part of the name, in any case, and an empty search shows everything', () => {
    expect(matchesSearch(items[0], 'backup')).toBe(true)
    expect(matchesSearch(items[0], 'BaCkUp')).toBe(true)
    expect(matchesSearch(items[0], '  ')).toBe(true)
    expect(matchesSearch(items[0], 'carry')).toBe(false)
  })
  it('every word must be found, in any order, and the group name counts too', () => {
    expect(matchesSearch(items[0], 'issue backup')).toBe(true)
    expect(matchesSearch(items[0], 'genisys issue')).toBe(true)
    expect(matchesSearch(items[3], 'genisys carry')).toBe(true)          // category + name: finds Carry bag updation under Genisys Support
    expect(matchesSearch(items[2], 'genisys carry')).toBe(false)         // a carry bag sub-category of ANOTHER category is not found by that
    expect(matchesSearch(items[4], '0.75')).toBe(true)
  })
  it('shows the matches, or only the ticked ones, or the ticked ones that match', () => {
    const ticked = new Set(['s2', 's3'])
    expect(visibleItems(items, 'carry', false, ticked).map((i) => i.id)).toEqual(['s3', 's4'])
    expect(visibleItems(items, '', true, ticked).map((i) => i.id)).toEqual(['s2', 's3'])
    expect(visibleItems(items, 'carry', true, ticked).map((i) => i.id)).toEqual(['s3'])
    expect(visibleItems(items, 'nothing like this', false, ticked)).toEqual([])
  })
  it('groups what is shown by its category, in first-seen order', () => {
    const g = groupItems(items)
    expect(g.map((x) => x.group)).toEqual(['GENISYS SUPPORT', 'CARRY BAG REQUIREMENT', 'ELECTRICAL PROBLEM'])
    expect(g[0].items.map((i) => i.id)).toEqual(['s1', 's2', 's4'])
    expect(groupItems([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])).toEqual([{ group: '', items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }])
  })
})

describe('ticking', () => {
  it('ticks several at once without doubling what is already ticked, and keeps the order', () => {
    expect(setMany(['s2'], ['s1', 's2', 's4'], true)).toEqual(['s2', 's1', 's4'])
    expect(setMany([], ['s1'], true)).toEqual(['s1'])
  })
  it('unticks several at once and leaves the rest', () => {
    expect(setMany(['s1', 's2', 's3'], ['s2', 's9'], false)).toEqual(['s1', 's3'])
  })
  it('the chips show the names of what is ticked; an entry that no longer exists is left out', () => {
    expect(tickedNames(items, ['s3', 'gone', 's1']).map((i) => i.name)).toEqual(['CARRY BAG SMALL', 'GENISYS BACKUP ISSUE'])
  })
})
