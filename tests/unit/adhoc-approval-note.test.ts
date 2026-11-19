import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Send for approval" with the technician's optional remarks and files: one public message is written for the approver, the approver's notification carries the remarks,
// and an approval sent with nothing extra writes no message at all.
vi.mock('server-only', () => ({}))
const notifyMock = vi.fn(() => Promise.resolve())
const logActivityMock = vi.fn(() => Promise.resolve())
const loggerError = vi.fn()
vi.mock('@/lib/notifications', () => ({ notify: (...a: unknown[]) => (notifyMock as (...x: unknown[]) => unknown)(...a) }))
vi.mock('@/lib/activity', () => ({ logActivity: (...a: unknown[]) => (logActivityMock as (...x: unknown[]) => unknown)(...a) }))
vi.mock('@/lib/observability/logger', () => ({ logger: { error: (...a: unknown[]) => loggerError(...a), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/approvals/store-users', () => ({ barStoreApprovers: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/requests/status-change', () => ({ stopOpenTimeEntries: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { createAdHocApproval } from '@/lib/approvals/adhoc'

type Op = { table: string; op: string; payload?: Record<string, unknown> }
let ops: Op[] = []
let commentFails = false

function admin() {
  return {
    from: (table: string) => {
      const rec: Op = { table, op: 'select' }
      const answer = () => {
        ops.push({ ...rec })
        if (table === 'approvals' && rec.op === 'select') return { data: null, error: null }
        if (table === 'approval_workflows') return { data: { id: 'wf-1' }, error: null }
        if (table === 'approvals' && rec.op === 'insert') return { data: { id: 'ap-1' }, error: null }
        if (table === 'request_comments') return commentFails ? { data: null, error: { message: 'boom', code: 'XX000' } } : { data: { id: 'note-1' }, error: null }
        return { data: null, error: null }
      }
      const proxy: unknown = new Proxy(() => {}, {
        get(_t, prop: string) {
          if (prop === 'then') { const p = Promise.resolve().then(answer); return p.then.bind(p) }
          return (...args: unknown[]) => { if (prop === 'insert' || prop === 'update' || prop === 'delete') { rec.op = prop; rec.payload = args[0] as Record<string, unknown> } return proxy }
        },
      })
      return proxy
    },
  }
}

const base = {
  request: { id: 'req-1', request_no: 'CKSD-001261', title: 'SHARE DRIVE RIGHTS', status: 'in_progress' as const, requester_id: 'u-1', org_id: 'org-1', waiting_since: null },
  approvers: [{ id: 'a-1', full_name: 'Raahul Vohra' }],
  senderId: 'tech-1',
  senderName: 'Ajay Kumar',
}
const comments = () => ops.filter((o) => o.table === 'request_comments' && o.op === 'insert')

beforeEach(() => { ops = []; commentFails = false; notifyMock.mockClear(); logActivityMock.mockClear(); loggerError.mockClear() })

describe('createAdHocApproval: remarks and files for the approver', () => {
  it('writes ONE public message with the remarks, from the technician, and returns its id so the files can be added to it', async () => {
    const r = await createAdHocApproval(admin() as never, { ...base, note: { remarks: 'Quote attached. Please approve by Friday.', fileCount: 1 } })
    expect(r.error).toBeUndefined()
    expect(r.commentId).toBe('note-1')
    expect(comments()).toHaveLength(1)
    const c = comments()[0].payload!
    expect(c).toMatchObject({ request_id: 'req-1', author_id: 'tech-1', is_internal: false })
    expect(String(c.body)).toContain('[Sent for approval] to Raahul Vohra')
    expect(String(c.body)).toContain('Quote attached. Please approve by Friday.')
  })

  it('files without remarks still make a message to hang them on', async () => {
    const r = await createAdHocApproval(admin() as never, { ...base, note: { remarks: '', fileCount: 2 } })
    expect(r.commentId).toBe('note-1')
    expect(String(comments()[0].payload!.body)).toMatch(/2 files are attached/)
  })

  it("the approver's notification carries the remarks and the number of files", async () => {
    await createAdHocApproval(admin() as never, { ...base, note: { remarks: 'Please approve', fileCount: 1 } })
    const told = (notifyMock.mock.calls as unknown as { 0: { recipientId: string; body: string } }[]).map((c) => c[0]).find((n) => n.recipientId === 'a-1')!
    expect(told.body).toContain('Remarks from Ajay Kumar: Please approve')
    expect(told.body).toContain('1 file is attached')
  })

  it('an approval sent with nothing extra writes no message and the notification is the usual one', async () => {
    const r = await createAdHocApproval(admin() as never, base)
    expect(r.commentId).toBeUndefined()
    expect(comments()).toHaveLength(0)
    const told = (notifyMock.mock.calls as unknown as { 0: { recipientId: string; body: string } }[]).map((c) => c[0]).find((n) => n.recipientId === 'a-1')!
    expect(told.body).toBe('"SHARE DRIVE RIGHTS" has been sent to you for approval.')
  })

  it('if the message cannot be saved the approval is still sent (and the failure is logged)', async () => {
    commentFails = true
    const r = await createAdHocApproval(admin() as never, { ...base, note: { remarks: 'x', fileCount: 0 } })
    expect(r.error).toBeUndefined()
    expect(r.commentId).toBeUndefined()
    expect(loggerError).toHaveBeenCalled()
    expect(ops.some((o) => o.table === 'requests' && o.op === 'update')).toBe(true)
  })
})
