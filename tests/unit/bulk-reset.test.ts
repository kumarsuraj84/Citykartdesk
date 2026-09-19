import { describe, expect, it } from 'vitest'
import { BULK_RESET_BATCH_SIZE, BULK_RESET_ROLES, chunk } from '@/lib/users/bulk-reset'

describe('bulk password reset helpers', () => {
  it('only ever targets users, agents and managers — never admins or platform owners', () => {
    expect(BULK_RESET_ROLES).toEqual(['user', 'agent', 'manager'])
    expect(BULK_RESET_ROLES).not.toContain('admin')
    expect(BULK_RESET_ROLES).not.toContain('platform_owner')
  })

  it('splits ids into batches no larger than the batch size, keeping order and losing none', () => {
    const ids = Array.from({ length: 95 }, (_, i) => `u${i}`)
    const batches = chunk(ids, BULK_RESET_BATCH_SIZE)
    expect(batches.every((b) => b.length <= BULK_RESET_BATCH_SIZE)).toBe(true)
    expect(batches.flat()).toEqual(ids)
    expect(batches).toHaveLength(Math.ceil(95 / BULK_RESET_BATCH_SIZE))
  })

  it('handles empty and exact-multiple input', () => {
    expect(chunk([], 40)).toEqual([])
    expect(chunk(['a', 'b'], 2)).toEqual([['a', 'b']])
  })
})
