import { describe, it, expect, vi, beforeEach } from 'vitest'

const { notifyMock, logActivityMock } = vi.hoisted(() => ({ notifyMock: vi.fn().mockResolvedValue(undefined), logActivityMock: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/notifications', () => ({ notify: notifyMock }))
vi.mock('@/lib/activity', () => ({ logActivity: logActivityMock }))

import { autoCloseDueRequests } from '@/lib/requests/auto-close'

/** A fake admin client: records the filters of the select, answers the rows given, and says every update matched. */
function fakeAdmin(rows: unknown[], readError: { message: string } | null = null) {
  const seen: { select: Array<[string, unknown[]]>; updates: Array<Record<string, unknown>> } = { select: [], updates: [] }
  const make = () => {
    let isUpdate = false
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === 'then') { const p = Promise.resolve().then(() => (isUpdate ? { data: { id: 'x' }, error: null } : { data: readError ? null : rows, error: readError })); return p.then.bind(p) }
        if (prop === 'maybeSingle') return () => Promise.resolve({ data: { id: 'x' }, error: null })
        return (...args: unknown[]) => {
          if (prop === 'update') { isUpdate = true; seen.updates.push(args[0] as Record<string, unknown>) } else if (!isUpdate) seen.select.push([prop, args])
          return proxy
        }
      },
    })
    return proxy
  }
  return { client: { from: () => make() }, seen }
}

beforeEach(() => { notifyMock.mockClear(); logActivityMock.mockClear() })

describe('autoCloseDueRequests', () => {
  it('B-13: only RESOLVED tickets are swept; a ticket cancelled by a rejected approval stays cancelled', async () => {
    const { client, seen } = fakeAdmin([])
    await autoCloseDueRequests(client, 'org-1', 10)
    expect(seen.select).toContainEqual(['eq', ['status', 'resolved']])
    expect(JSON.stringify(seen.select)).not.toContain('cancelled')
  })

  it('B-13: every automatic close is written to the ticket\'s history', async () => {
    const { client, seen } = fakeAdmin([{ id: 'r1', requester_id: 'u1', title: 'T', status: 'resolved', reopen_deadline_at: '2026-10-01T00:00:00Z' }])
    const closed = await autoCloseDueRequests(client, null, 10)
    expect(closed).toBe(1)
    expect(seen.updates[0]).toMatchObject({ status: 'closed', reopen_deadline_at: null })
    expect(logActivityMock).toHaveBeenCalledWith({ requestId: 'r1', actorId: null, action: 'status_changed', metadata: { from: 'resolved', to: 'closed', via: 'auto_close' } })
  })

  it('a failed read is an error, not "nothing to close"', async () => {
    const { client } = fakeAdmin([], { message: 'down' })
    await expect(autoCloseDueRequests(client, null, 10)).rejects.toThrow(/Could not read/)
  })
})
