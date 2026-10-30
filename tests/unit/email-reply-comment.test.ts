// B-24: an emailed reply goes through the same steps as a comment posted in the portal: the history shows the move out of "waiting on user", a reply from the
// requester on a RESOLVED ticket reopens it (inside the window), and a reply to a closed or cancelled ticket is stored but marked as a late reply.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './helpers/fake-db'

let db: FakeDb
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
const logActivity = vi.fn(async () => ({}))
vi.mock('@/lib/activity', () => ({ logActivity: (...a: unknown[]) => (logActivity as (...x: unknown[]) => unknown)(...a) }))
vi.mock('@/lib/notifications', () => ({
  notify: async () => {},
  getRequestAudience: async () => ({ requesterId: 'u-req', assigneeId: 'u-tech', collaboratorIds: [] }),
}))
const applyStatusChange = vi.fn(async () => ({}))
vi.mock('@/lib/requests/status-change', () => ({ applyStatusChange: (...a: unknown[]) => (applyStatusChange as (...x: unknown[]) => unknown)(...a) }))

import { appendEmailReplyComment } from '@/lib/requests/email-reply-comment'

function seed(status: string, extra: Record<string, unknown> = {}) {
  db = fakeDb({
    requests: [{ id: 'r1', status, requester_id: 'u-req', waiting_since: '2026-10-01T10:00:00.000Z', response_due_at: '2026-10-05T10:00:00.000Z', resolution_due_at: '2026-10-10T10:00:00.000Z', paused_ms_total: 0, ...extra }],
    request_comments: [],
    profiles: [{ id: 'u-req', full_name: 'Store Requester', team_members: [] }],
  })
}
const reply = (author = { kind: 'profile' as const, profileId: 'u-req', name: 'Store Requester' }) => appendEmailReplyComment({ requestId: 'r1', body: 'It is still not cooling.', author })
const actions = () => logActivity.mock.calls.map((c) => (c as unknown[])[0] as { action: string; metadata?: Record<string, unknown> })

beforeEach(() => { logActivity.mockClear(); applyStatusChange.mockClear(); applyStatusChange.mockResolvedValue({}) })

describe('a requester\'s e-mail reply', () => {
  it('while waiting on the user: the ticket resumes, the due dates are extended, and the history says so', async () => {
    seed('waiting_user')
    const r = await reply()
    expect(r.commentId).toBeTruthy()
    expect(db.tables.requests[0]).toMatchObject({ status: 'in_progress', waiting_since: null })
    expect(Number(db.tables.requests[0].paused_ms_total)).toBeGreaterThan(0)
    expect(actions().filter((a) => a.action === 'status_changed')).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ from: 'waiting_user', to: 'in_progress', via: 'email' }) })])
  })

  it('a ticket the technician already moved on is not pulled back, and no history entry is written for a move that did not happen', async () => {
    seed('resolved')
    db.tables.requests[0].status = 'on_hold'
    await reply()
    expect(db.tables.requests[0].status).toBe('on_hold')
    expect(actions().some((a) => a.action === 'status_changed')).toBe(false)
  })

  it('on a RESOLVED ticket it reopens it through the normal status change (which checks the reopen window)', async () => {
    seed('resolved')
    db.tables.profiles[0].team_members = []
    await reply()
    expect(applyStatusChange).toHaveBeenCalledTimes(1)
    const call = applyStatusChange.mock.calls[0] as unknown as [unknown, string, string, string]
    expect(call[1]).toBe('r1')
    expect(call[2]).toBe('open')
    expect(call[3]).toMatch(/replied by e-mail/)
  })

  it('outside the reopen window the reply stays in the conversation and the ticket stays resolved', async () => {
    seed('resolved')
    applyStatusChange.mockResolvedValue({ error: 'The reopen window for this request has expired.' } as never)
    const r = await reply()
    expect(r.commentId).toBeTruthy()
    expect(db.tables.request_comments).toHaveLength(1)
    expect(db.tables.requests[0].status).toBe('resolved')
  })

  it('a reply to a CLOSED or CANCELLED ticket is stored, marked as a late reply, and never reopens it', async () => {
    for (const status of ['closed', 'cancelled']) {
      logActivity.mockClear(); applyStatusChange.mockClear()
      seed(status)
      const r = await reply()
      expect(r.commentId).toBeTruthy()
      expect(applyStatusChange).not.toHaveBeenCalled()
      expect(actions().find((a) => a.action === 'comment_added')?.metadata).toMatchObject({ via: 'email', ticket_status: status })
    }
  })

  it('an OEM reply on a resolved ticket does not reopen it (only the requester can)', async () => {
    seed('resolved')
    await reply({ kind: 'oem', name: 'Daikin', email: 'service@daikin.test' } as never)
    expect(applyStatusChange).not.toHaveBeenCalled()
  })
})
