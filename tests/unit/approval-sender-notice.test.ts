import { describe, it, expect } from 'vitest'
import { resolveSenderNotice, senderNoticeRecipient, wasSentViaTransfer } from '@/lib/approvals/sender-notice'
import { approvalDecisionEmail } from '@/lib/email/templates'

const base = { requestedBy: 'admin', requesterId: 'req', approverId: 'appr', assigneeId: 'tech', sentViaTransfer: false }

describe('who is told besides the requester when an approval is decided', () => {
  it('normally: the person who sent it for approval', () => {
    expect(senderNoticeRecipient(base)).toEqual({ recipientId: 'admin', role: 'sender' })
  })
  it('never the requester (already told) and never the approver', () => {
    expect(senderNoticeRecipient({ ...base, requestedBy: 'req' })).toBeNull()
    expect(senderNoticeRecipient({ ...base, requestedBy: 'appr' })).toBeNull()
    expect(senderNoticeRecipient({ ...base, requestedBy: null })).toBeNull()
  })
  it('sent by the moved-tickets tool: the assigned technician is told, NOT the administrator who pressed the button', () => {
    expect(senderNoticeRecipient({ ...base, sentViaTransfer: true })).toEqual({ recipientId: 'tech', role: 'assignee' })
  })
  it('sent by the moved-tickets tool: nobody extra when the ticket has no technician, or the technician is the requester or the approver', () => {
    expect(senderNoticeRecipient({ ...base, sentViaTransfer: true, assigneeId: null })).toBeNull()
    expect(senderNoticeRecipient({ ...base, sentViaTransfer: true, assigneeId: 'req' })).toBeNull()
    expect(senderNoticeRecipient({ ...base, sentViaTransfer: true, assigneeId: 'appr' })).toBeNull()
  })
})

/** a tiny stand-in for the database: request_activity rows and the ticket row */
function fakeDb(activity: { metadata: { via?: string } | null }[] | 'fails', assignedTo: string | null) {
  return {
    from: (t: string) => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = self
      if (t === 'request_activity') {
        if (activity === 'fails') chain.limit = () => Promise.reject(new Error('down'))
        else chain.limit = () => Promise.resolve({ data: activity })
      }
      if (t === 'requests') chain.maybeSingle = () => Promise.resolve({ data: { assigned_to: assignedTo } })
      return chain
    },
  }
}

describe('looking it up', () => {
  const p = { requestId: 'r1', requestedBy: 'admin', requesterId: 'req', approverId: 'appr' }
  it('an approval sent by the moved-tickets tool goes to the assigned technician', async () => {
    expect(await resolveSenderNotice(fakeDb([{ metadata: { via: 'zoho_transfer' } }], 'tech'), p)).toEqual({ recipientId: 'tech', role: 'assignee' })
  })
  it('an ordinary approval still goes to the sender', async () => {
    expect(await resolveSenderNotice(fakeDb([{ metadata: { approver_names: [] } as never }], 'tech'), p)).toEqual({ recipientId: 'admin', role: 'sender' })
    expect(await resolveSenderNotice(fakeDb([], 'tech'), p)).toEqual({ recipientId: 'admin', role: 'sender' })
  })
  it('a failed lookup keeps the old behaviour (the sender is told), it never blocks the decision', async () => {
    expect(await wasSentViaTransfer(fakeDb('fails', null), 'r1')).toBe(false)
    expect(await resolveSenderNotice(fakeDb('fails', null), p)).toEqual({ recipientId: 'admin', role: 'sender' })
  })
  it('no sender recorded: nobody extra', async () => {
    expect(await resolveSenderNotice(fakeDb([{ metadata: { via: 'zoho_transfer' } }], 'tech'), { ...p, requestedBy: null })).toBeNull()
  })
})

describe('the e-mail wording for each kind of reader', () => {
  const d = { recipientName: 'Aakanksha', requestTitle: 'ZOHO-1 — BILL', requestUrl: 'http://x/requests/1', approverName: 'Hariom' }
  it('requester: "your request"; sender: "you sent for approval"; technician: "assigned to you"', () => {
    expect(approvalDecisionEmail({ ...d, decision: 'approved' }).html).toContain('your request')
    expect(approvalDecisionEmail({ ...d, decision: 'approved', recipientIsRequester: false }).html).toContain('you sent for approval')
    const t = approvalDecisionEmail({ ...d, decision: 'approved', recipientIsRequester: false, recipientIsAssignee: true }).html
    expect(t).toContain('assigned to you')
    expect(t).not.toContain('you sent for approval')
    const r = approvalDecisionEmail({ ...d, decision: 'rejected', recipientIsRequester: false, recipientIsAssignee: true }).html
    expect(r).toContain('assigned to you')
    expect(r).not.toContain('you sent for approval')
  })
})
