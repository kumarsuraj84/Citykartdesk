import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { toEventRows, MAX_EVENTS_PER_BATCH } from '@/lib/events/record'

const ctx = { orgId: 'o1', userId: 'u1', sessionId: 's1', userAgent: 'UA' }

describe('event log row shaping', () => {
  it('keeps valid events and drops unknown kinds', () => {
    const rows = toEventRows([{ kind: 'click', target: 'button:Save' }, { kind: 'hack' }, { kind: 'pageview', path: '/home' }], ctx)
    expect(rows.map((r) => r.kind)).toEqual(['click', 'pageview'])
    expect(rows[0]).toMatchObject({ org_id: 'o1', user_id: 'u1', session_id: 's1', target: 'button:Save' })
  })

  it('caps the batch and truncates long fields', () => {
    const many = Array.from({ length: 80 }, () => ({ kind: 'click', target: 'x'.repeat(500), message: 'm'.repeat(2000) }))
    const rows = toEventRows(many, ctx)
    expect(rows).toHaveLength(MAX_EVENTS_PER_BATCH)
    expect(rows[0].target).toHaveLength(120)
    expect(rows[0].message).toHaveLength(500)
  })

  it('ignores a browser clock that is far from the server clock', () => {
    const rows = toEventRows([{ kind: 'click', at: 1000 }], ctx)
    expect(Math.abs(Date.now() - new Date(rows[0].created_at).getTime())).toBeLessThan(5000)
  })

  it('shrinks oversized detail instead of storing it', () => {
    const rows = toEventRows([{ kind: 'js_error', detail: { blob: 'z'.repeat(5000) } }], ctx)
    expect(rows[0].detail).toHaveProperty('truncated')
  })
})
