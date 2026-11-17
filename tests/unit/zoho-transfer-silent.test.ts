import { describe, expect, it } from 'vitest'
import { isMovedRequestNo, movedTicketsActive, MOVED_ACTIVE_SETTING, withoutSilentMoved, ZOHO_NUMBER_LIKE } from '@/lib/zoho/transfer/silent'

const fakeQuery = () => { const calls: unknown[][] = []; const q = { not: (...a: unknown[]) => { calls.push(a); return q }, calls }; return q }
const fakeAdmin = (value: unknown, fail = false) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { if (fail) throw new Error('down'); return { data: value === undefined ? null : { value } } } }) }) }),
})

describe('tickets moved from Zoho are silent until switched on', () => {
  it('leaves ZOHO- tickets out of a scheduled-job query while silent, and keeps them when switched on', () => {
    const silent = fakeQuery(); withoutSilentMoved(silent, false)
    expect(silent.calls).toEqual([['request_no', 'like', ZOHO_NUMBER_LIKE]])
    const active = fakeQuery(); withoutSilentMoved(active, true)
    expect(active.calls).toEqual([])
  })
  it('is OFF by default, ON only for the exact word true, and any failure reads as OFF', async () => {
    expect(await movedTicketsActive(fakeAdmin(undefined) as never)).toBe(false)
    expect(await movedTicketsActive(fakeAdmin('false') as never)).toBe(false)
    expect(await movedTicketsActive(fakeAdmin('yes') as never)).toBe(false)
    expect(await movedTicketsActive(fakeAdmin('true') as never)).toBe(true)
    expect(await movedTicketsActive(fakeAdmin('TRUE') as never)).toBe(true)
    expect(await movedTicketsActive(fakeAdmin('true', true) as never)).toBe(false)
    expect(MOVED_ACTIVE_SETTING).toBe('zoho.moved_tickets_active')
  })
  it('recognises a moved ticket number', () => {
    expect(isMovedRequestNo('ZOHO-48213')).toBe(true)
    expect(isMovedRequestNo('CKSD-000746')).toBe(false)
    expect(isMovedRequestNo('ZOHO-')).toBe(false)
  })
})
