import { describe, expect, it } from 'vitest'
import { compactRows, expandRows } from '@/lib/reporting/compact-rows'

type Row = Record<string, string | number | boolean | null>

describe('compactRows / expandRows (Report Builder rows sent without their empty cells)', () => {
  const make = (): Row[] => [
    { request_no: 'CKSD-1', title: 'A', note: '', count: 0, flag: false, form_a: null, form_b: 'x', when: null },
    { request_no: 'CKSD-2', title: 'B', note: null, count: 3, flag: true, form_a: 'y', form_b: null, when: '2026-11-01' },
  ]

  it('leaves out only the null cells; empty text, 0 and false are real values and stay', () => {
    const rows = make()
    compactRows(rows)
    expect(rows[0]).toEqual({ request_no: 'CKSD-1', title: 'A', note: '', count: 0, flag: false, form_b: 'x' })
    expect(rows[1]).toEqual({ request_no: 'CKSD-2', title: 'B', count: 3, flag: true, form_a: 'y', when: '2026-11-01' })
  })

  it('returns every column the rows had, whichever row had it', () => {
    expect(compactRows(make()).sort()).toEqual(['count', 'flag', 'form_a', 'form_b', 'note', 'request_no', 'title', 'when'])
  })

  it('compact then expand gives back exactly the original rows (same columns, same values)', () => {
    const original = make()
    const rows = make()
    const keys = compactRows(rows)
    expandRows(rows, keys)
    expect(rows).toEqual(original)
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(Object.keys(original[0]).sort())
  })

  it('does not add a column the rows never had', () => {
    const rows: Row[] = [{ a: 1, b: null }]
    const keys = compactRows(rows)
    expandRows(rows, keys)
    expect(Object.keys(rows[0]).sort()).toEqual(['a', 'b'])
    expect('__count__' in rows[0]).toBe(false)
  })

  it('handles no rows', () => {
    expect(compactRows([])).toEqual([])
    expect(expandRows([], ['a'])).toEqual([])
  })

  it('makes a realistic report much smaller to send', () => {
    // 40 form columns, only 3 answered per ticket: the shape of a live report
    const rows: Row[] = Array.from({ length: 200 }, (_, i) => {
      const r: Row = { request_no: `CKSD-${i}`, title: 'T', status: 'open' }
      for (let k = 0; k < 40; k++) r[`form:00000000-0000-0000-0000-${String(k).padStart(12, '0')}`] = k < 3 ? 'answer' : null
      return r
    })
    const before = JSON.stringify(rows).length
    compactRows(rows)
    expect(JSON.stringify(rows).length).toBeLessThan(before * 0.4)
  })
})
