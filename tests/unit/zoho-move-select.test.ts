import { describe, it, expect } from 'vitest'
import { filterRows, pruneSelection, selectRange, selectReady, toggleOne, viewCounts, type PickRow } from '@/lib/zoho/transfer/select'

const R = (zohoNo: number, ready: boolean, ...codes: string[]): PickRow => ({ zohoNo, ready, codes })
const rows: PickRow[] = [R(1, true), R(2, false, 'service_unmapped'), R(3, true), R(4, false, 'already_moved'), R(5, true), R(6, false, 'service_unmapped', 'status_unmapped')]

describe('Move Zoho tickets: the views', () => {
  it('counts', () => { expect(viewCounts(rows)).toEqual({ all: 6, ready: 3, blocked: 3 }) })
  it('all / ready / cannot move yet', () => {
    expect(filterRows(rows, 'all', null).map((r) => r.zohoNo)).toEqual([1, 2, 3, 4, 5, 6])
    expect(filterRows(rows, 'ready', null).map((r) => r.zohoNo)).toEqual([1, 3, 5])
    expect(filterRows(rows, 'blocked', null).map((r) => r.zohoNo)).toEqual([2, 4, 6])
  })
  it('one reason narrows the list (a ticket with several reasons shows under each)', () => {
    expect(filterRows(rows, 'blocked', 'service_unmapped').map((r) => r.zohoNo)).toEqual([2, 6])
    expect(filterRows(rows, 'all', 'status_unmapped').map((r) => r.zohoNo)).toEqual([6])
    expect(filterRows(rows, 'ready', 'service_unmapped')).toEqual([1, 3, 5].map((n) => R(n, true)))   // a reason never hides ready tickets in the ready view
  })
})

describe('Move Zoho tickets: choosing tickets', () => {
  it('"select all that can be moved" takes the ready rows of the view, in order, and never a blocked one', () => {
    expect(selectReady(rows, 25)).toEqual({ selected: [1, 3, 5], readyCount: 3, capped: false })
    expect(selectReady(filterRows(rows, 'blocked', null), 25)).toEqual({ selected: [], readyCount: 0, capped: false })
  })
  it('stops at one batch and says so', () => {
    const many = Array.from({ length: 60 }, (_, i) => R(i + 1, true))
    const r = selectReady(many, 25)
    expect(r.selected).toHaveLength(25)
    expect(r.selected[0]).toBe(1)
    expect(r.capped).toBe(true)
    expect(r.readyCount).toBe(60)
  })
  it('keeps what was already ticked (counted in the limit) and drops what is no longer visible or ready', () => {
    expect(selectReady(rows, 2, [5]).selected).toEqual([5, 1])
    expect(selectReady(filterRows(rows, 'ready', null), 25, [2, 3]).selected).toEqual([3, 1, 5])   // 2 is blocked: dropped
  })
  it('one click ticks and unticks; a blocked ticket is never ticked; the limit holds', () => {
    expect(toggleOne([], R(1, true), 25)).toEqual({ selected: [1], refusedForLimit: false })
    expect(toggleOne([1], R(1, true), 25)).toEqual({ selected: [], refusedForLimit: false })
    expect(toggleOne([], R(2, false, 'x'), 25)).toEqual({ selected: [], refusedForLimit: false })
    expect(toggleOne([1, 3], R(5, true), 2)).toEqual({ selected: [1, 3], refusedForLimit: true })
  })
  it('shift-click takes every ready row between two rows, either direction, up to the limit', () => {
    expect(selectRange(rows, 1, 5, [], 25)).toEqual({ selected: [1, 3, 5], capped: false })
    expect(selectRange(rows, 5, 3, [], 25)).toEqual({ selected: [3, 5], capped: false })
    expect(selectRange(rows, 1, 5, [], 2)).toEqual({ selected: [1, 3], capped: true })
    expect(selectRange(rows, 1, 99, [7], 25)).toEqual({ selected: [7], capped: false })
  })
  it('after a refresh, tickets that were moved (no longer ready) leave the selection', () => {
    expect(pruneSelection([1, 3, 5], [R(1, false, 'already_moved'), R(3, true), R(5, true)])).toEqual([3, 5])
    expect(pruneSelection([1, 9], rows)).toEqual([1])
  })
})
