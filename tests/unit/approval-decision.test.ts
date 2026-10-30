// B-05 / B-06: deciding an approval must not leave the approval settled while the ticket stays on hold (or the other way round), must say what really happened
// to the ticket, and a recall must put a stuck ticket back. In-memory database, no network.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb, type Op } from './helpers/fake-db'

let db: FakeDb
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
const logActivity = vi.fn(async () => ({}))
vi.mock('@/lib/activity', () => ({ logActivity: (...a: unknown[]) => (logActivity as (...x: unknown[]) => unknown)(...a) }))
const notify = vi.fn(async () => {})
vi.mock('@/lib/notifications', () => ({ notify: (...a: unknown[]) => (notify as (...x: unknown[]) => unknown)(...a) }))

import { decideApproval } from '@/lib/approvals/decision'
import { recallApprovalCore } from '@/lib/approvals/recall'

const tech = { id: 'u-tech', role: 'agent', full_name: 'Tech Nician' }
const boss = { id: 'u-boss', role: 'manager', full_name: 'Big Boss' }

function seed(over: { request?: Record<string, unknown>; approval?: Record<string, unknown>; fail?: (op: Op) => { message: string; code?: string } | undefined } = {}) {
  db = fakeDb({
    approvals: [{ id: 'a1', request_id: 'r1', workflow_id: 'w1', current_step: 0, status: 'pending', requested_by: 'u-tech', ...over.approval }],
    approval_workflow_steps: [
      { id: 's1', workflow_id: 'w1', step_order: 1, approver_type: 'specific_user', approver_user_id: 'u-boss' },
      { id: 's2', workflow_id: 'w1', step_order: 2, approver_type: 'specific_user', approver_user_id: 'u-other' },
    ],
    approval_decisions: [],
    requests: [{
      id: 'r1', org_id: 'org-1', title: 'Fix AC', status: 'pending_approval', pre_approval_status: 'in_progress', requester_id: 'u-req',
      waiting_since: '2026-10-01T10:00:00.000Z', response_due_at: '2026-10-05T10:00:00.000Z', resolution_due_at: '2026-10-10T10:00:00.000Z', paused_ms_total: 0, ...over.request,
    }],
    notifications: [],
    request_time_entries: [{ id: 't1', request_id: 'r1', user_id: 'u-tech', started_at: '2026-10-01T09:00:00.000Z', stopped_at: null }],
  }, { fail: over.fail })
}
const row = (t: string) => db.tables[t]
const statusChanges = () => logActivity.mock.calls.map((c) => (c as unknown[])[0] as { action: string; metadata?: Record<string, unknown> }).filter((a) => a.action === 'status_changed')

beforeEach(() => { logActivity.mockClear(); notify.mockClear() })

describe('approving', () => {
  it('moves the ticket back to what it was, settles the approval, and logs the real status', async () => {
    seed({ request: { pre_approval_status: 'waiting_user' } })
    const r = await decideApproval('approve', 'a1', boss, db as never, 'ok')
    expect(r).toEqual({})
    expect(row('approvals')[0].status).toBe('approved')
    expect(row('requests')[0]).toMatchObject({ status: 'waiting_user', pre_approval_status: null })
    expect(statusChanges()[0].metadata).toMatchObject({ from: 'pending_approval', to: 'waiting_user' })   // not the old hard-coded in_progress
    expect(row('approval_decisions')).toHaveLength(1)
  })

  it('credits the hold time to the due dates', async () => {
    seed()
    await decideApproval('approve', 'a1', boss, db as never, 'ok')
    const t = row('requests')[0]
    expect(new Date(t.resolution_due_at as string).getTime()).toBeGreaterThan(new Date('2026-10-10T10:00:00.000Z').getTime())
    expect(Number(t.paused_ms_total)).toBeGreaterThan(0)
  })

  it('if the ticket cannot be updated, the approval is put back to pending and the decision taken back, so the approver can try again', async () => {
    seed({ fail: (op) => (op.table === 'requests' && op.kind === 'update' ? { message: 'connection lost' } : undefined) })
    const r = await decideApproval('approve', 'a1', boss, db as never, 'ok')
    expect(r.error).toBeTruthy()
    expect(row('approvals')[0].status).toBe('pending')
    expect(row('approval_decisions')).toHaveLength(0)
    expect(row('requests')[0].status).toBe('pending_approval')
    expect(statusChanges()).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('a ticket that was moved on meanwhile is not claimed to have resumed (no status entry, requester not told work is resuming)', async () => {
    seed({ request: { status: 'resolved' } })
    const r = await decideApproval('approve', 'a1', boss, db as never, 'ok')
    expect(r).toEqual({})
    expect(row('approvals')[0].status).toBe('approved')
    expect(row('requests')[0].status).toBe('resolved')
    expect(statusChanges()).toHaveLength(0)
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'approved', metadata: expect.objectContaining({ ticket_already_moved_on: true }) }))
    expect(notify.mock.calls.map((c) => (c as unknown[])[0] as { title: string }).some((n) => /approved/i.test(n.title) && /resum/i.test(String((n as never as { body?: string }).body ?? '')))).toBe(false)
  })

  it('an approval that loses the race to a rejection leaves no stray "approved" decision and says so', async () => {
    seed({ fail: (op) => { if (op.table === 'approvals' && op.kind === 'update') db.tables.approvals[0].status = 'rejected'; return undefined } })
    const r = await decideApproval('approve', 'a1', boss, db as never, 'ok')
    expect(r.error).toMatch(/already been decided/)
    expect(row('approval_decisions')).toHaveLength(0)
    expect(row('requests')[0].status).toBe('pending_approval')
  })

  it('a decision that arrives after the approval was settled is refused', async () => {
    seed({ approval: { status: 'approved' } })
    const r = await decideApproval('approve', 'a1', boss, db as never, 'ok')
    expect(r.error).toMatch(/no longer pending|already been decided/)
    expect(row('approval_decisions')).toHaveLength(0)
  })
})

describe('rejecting', () => {
  it('cancels the ticket still waiting for it and logs it', async () => {
    seed()
    const r = await decideApproval('reject', 'a1', boss, db as never, 'no')
    expect(r).toEqual({})
    expect(row('approvals')[0].status).toBe('rejected')
    expect(row('requests')[0]).toMatchObject({ status: 'cancelled', cancellation_reason: 'approval_rejected' })
    expect(statusChanges()[0].metadata).toMatchObject({ to: 'cancelled' })
  })

  it('stops the open timer of the cancelled ticket (B-07)', async () => {
    seed()
    await decideApproval('reject', 'a1', boss, db as never, 'no')
    expect(row('request_time_entries')[0].stopped_at).not.toBeNull()
  })

  it('leaves the timer alone when the ticket was not cancelled by this rejection', async () => {
    seed({ request: { status: 'in_progress' } })
    await decideApproval('reject', 'a1', boss, db as never, 'no')
    expect(row('request_time_entries')[0].stopped_at).toBeNull()
  })

  it('a rejection that loses the race writes no stray decision and says so (it used to return success)', async () => {
    // another approver settles it between the check and the guarded update
    seed({ fail: (op) => { if (op.table === 'approvals' && op.kind === 'update') db.tables.approvals[0].status = 'approved'; return undefined } })
    const r = await decideApproval('reject', 'a1', boss, db as never, 'no')
    expect(r.error).toMatch(/already been decided/)
    expect(row('approval_decisions')).toHaveLength(0)
    expect(row('requests')[0].status).toBe('pending_approval')
  })

  it('does not force a ticket that moved on to cancelled', async () => {
    seed({ request: { status: 'in_progress' } })
    const r = await decideApproval('reject', 'a1', boss, db as never, 'no')
    expect(r).toEqual({})
    expect(row('approvals')[0].status).toBe('rejected')
    expect(row('requests')[0].status).toBe('in_progress')
    expect(statusChanges()).toHaveLength(0)
  })

  it('if the ticket cannot be updated, everything is undone and the approver can try again', async () => {
    seed({ fail: (op) => (op.table === 'requests' && op.kind === 'update' ? { message: 'boom' } : undefined) })
    const r = await decideApproval('reject', 'a1', boss, db as never, 'no')
    expect(r.error).toBeTruthy()
    expect(row('approvals')[0].status).toBe('pending')
    expect(row('approval_decisions')).toHaveLength(0)
  })
})

describe('recalling an approval', () => {
  const manager = { ...boss, org_id: 'org-1' }

  it('a manager withdraws it: the approval is cancelled and the ticket goes back to where it was, with the hold time credited', async () => {
    seed()
    const r = await recallApprovalCore(db as never, manager, 'r1', 'wrong approver')
    expect(r).toEqual({})
    expect(row('approvals')[0].status).toBe('cancelled')
    expect(row('requests')[0]).toMatchObject({ status: 'in_progress', pre_approval_status: null, waiting_since: null })
    expect(Number(row('requests')[0].paused_ms_total)).toBeGreaterThan(0)
    expect(statusChanges()[0].metadata).toMatchObject({ from: 'pending_approval', to: 'in_progress', approval_recalled: true, reason: 'wrong approver' })
    // the people who were to decide, the sender and the requester are told (not the person who recalled it)
    const told = notify.mock.calls.map((c) => ((c as unknown[])[0] as { recipientId: string }).recipientId).sort()
    expect(told).toEqual(['u-other', 'u-req', 'u-tech'])
  })

  it('a ticket that was waiting on the user goes back to waiting on the user', async () => {
    seed({ request: { pre_approval_status: 'waiting_user' } })
    await recallApprovalCore(db as never, manager, 'r1')
    expect(row('requests')[0].status).toBe('waiting_user')
    expect(row('requests')[0].waiting_since).not.toBeNull()
  })

  it('stops a timer when the ticket goes back to waiting on the user, keeps it when back to in progress (B-07)', async () => {
    seed({ request: { pre_approval_status: 'waiting_user' } })
    await recallApprovalCore(db as never, manager, 'r1')
    expect(row('request_time_entries')[0].stopped_at).not.toBeNull()
    seed()
    await recallApprovalCore(db as never, manager, 'r1')
    expect(row('request_time_entries')[0].stopped_at).toBeNull()
  })

  it('is for managers, admins and platform owners only', async () => {
    seed()
    const r = await recallApprovalCore(db as never, { ...tech, org_id: 'org-1' }, 'r1')
    expect(r.error).toMatch(/manager or an admin/)
    expect(row('approvals')[0].status).toBe('pending')
  })

  it('cannot reach another organisation\'s ticket', async () => {
    seed()
    const r = await recallApprovalCore(db as never, { ...manager, org_id: 'org-2' }, 'r1')
    expect(r.error).toBe('Request not found.')
    expect(row('approvals')[0].status).toBe('pending')
  })

  it('refuses a ticket that is not waiting for an approval', async () => {
    seed({ request: { status: 'in_progress' } })
    expect((await recallApprovalCore(db as never, manager, 'r1')).error).toMatch(/not waiting/)
  })

  it('if the ticket cannot be moved back, the approval is put back to pending (nothing half done)', async () => {
    seed({ fail: (op) => (op.table === 'requests' && op.kind === 'update' ? { message: 'boom' } : undefined) })
    const r = await recallApprovalCore(db as never, manager, 'r1')
    expect(r.error).toBeTruthy()
    expect(row('approvals')[0].status).toBe('pending')
  })
})
