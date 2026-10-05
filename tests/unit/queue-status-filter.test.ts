import { describe, it, expect } from 'vitest'
import { resolveQueueStatusFilter } from '@/lib/requests/queue-status-filter'

describe('resolveQueueStatusFilter (technicians\' Agent Requests page)', () => {
  it('hides resolved, closed and cancelled tickets by default', () => {
    expect(resolveQueueStatusFilter(undefined)).toBe('unresolved')
    expect(resolveQueueStatusFilter('')).toBe('unresolved')
  })

  it('"Active" means the same thing as the default', () => {
    expect(resolveQueueStatusFilter('active')).toBe('unresolved')
    expect(resolveQueueStatusFilter('unresolved')).toBe('unresolved')
  })

  it('Resolved, Closed and every other status are still reachable from the filter', () => {
    expect(resolveQueueStatusFilter('resolved')).toBe('resolved')
    expect(resolveQueueStatusFilter('closed')).toBe('closed')
    expect(resolveQueueStatusFilter('waiting_user')).toBe('waiting_user')
    expect(resolveQueueStatusFilter('hold_purchase_ho')).toBe('hold_purchase_ho')
  })

  it('"All" shows everything', () => {
    expect(resolveQueueStatusFilter('all')).toBeUndefined()
  })
})
