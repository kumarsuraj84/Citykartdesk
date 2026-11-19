// Every ticket e-mail names the Requester and the Technician (lib/email/parties.ts), and shows what the person who did something is on the ticket.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { to: string; subject: string; html: string; text: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string; text: string }) => { sent.push(p); return {} }),
}))

import { NOT_ASSIGNED, nameWithRoleHtml, partiesHtml, partiesText, partyData, partiesFromData, roleOnTicket } from '@/lib/email/parties'
import { sendNotificationEmail } from '@/lib/email/notify-email'
import { csatReminderEmail, csatResolvedEmail } from '@/lib/email/csat-templates'
import { approvalReminderEmail } from '@/lib/email/approval-reminder'
import { requestCreatedEmail, commentAddedEmail } from '@/lib/email/templates'

beforeEach(() => { sent.length = 0; process.env.NEXT_PUBLIC_APP_URL = 'http://app.test' })

const rahul = { requesterName: 'Rahul Sharma', technicianName: 'Amit Verma' }

describe('the block', () => {
  it('names both people, and marks the reader with "(you)"', () => {
    const forRequester = partiesHtml({ ...rahul, requesterIsYou: true })
    expect(forRequester).toContain('Requester')
    expect(forRequester).toContain('Rahul Sharma (you)')
    expect(forRequester).toContain('Amit Verma')
    expect(forRequester).not.toContain('Amit Verma (you)')
    const forTech = partiesHtml({ ...rahul, technicianIsYou: true })
    expect(forTech).toContain('Amit Verma (you)')
    expect(forTech).not.toContain('Rahul Sharma (you)')
    expect(partiesText({ ...rahul, technicianIsYou: true })).toBe('Requester: Rahul Sharma\nTechnician: Amit Verma (you)')
  })
  it('says "Not assigned yet" when nobody has the ticket', () => {
    expect(partiesHtml({ requesterName: 'Rahul Sharma', technicianName: null })).toContain(NOT_ASSIGNED)
    expect(partiesText({ requesterName: 'Rahul Sharma', technicianName: '  ' })).toContain(`Technician: ${NOT_ASSIGNED}`)
  })
  it('shows nothing for a mail that is not about a ticket', () => {
    expect(partiesHtml(undefined)).toBe('')
    expect(partiesText(undefined)).toBe('')
    expect(partiesHtml({ requesterName: '', technicianName: null })).toBe('')
  })
  it('escapes names (a name is typed by people)', () => {
    const h = partiesHtml({ requesterName: '<img src=x onerror=alert(1)>', technicianName: 'A & B' })
    expect(h).not.toContain('<img')
    expect(h).toContain('&lt;img')
    expect(h).toContain('A &amp; B')
    expect(nameWithRoleHtml('<b>x</b>', 'Technician')).toBe('&lt;b&gt;x&lt;/b&gt; (Technician)')
  })
  it('extra lines (who sent it for approval) are added under the two names', () => {
    const h = partiesHtml({ ...rahul, extra: [{ label: 'Sent for approval by', value: 'Amit Verma' }, { label: 'Empty', value: ' ' }] })
    expect(h).toContain('Sent for approval by')
    expect(h).not.toContain('Empty')
  })
})

describe('what the person who did it is on the ticket', () => {
  const ctx = { requesterId: 'r', assigneeId: 't' }
  it('requester, assigned technician, any other technician, manager, someone else', () => {
    expect(roleOnTicket({ ...ctx, actorId: 'r', userRole: 'user' })).toBe('Requester')
    expect(roleOnTicket({ ...ctx, actorId: 't', userRole: 'agent' })).toBe('Technician')
    expect(roleOnTicket({ ...ctx, actorId: 'x', userRole: 'agent' })).toBe('Technician')
    for (const role of ['manager', 'admin', 'platform_owner']) expect(roleOnTicket({ ...ctx, actorId: 'm', userRole: role })).toBe('Manager')
    expect(roleOnTicket({ ...ctx, actorId: 'colleague', userRole: 'user' })).toBe('Other')
  })
  it('no person (a system action) = no label', () => {
    expect(roleOnTicket({ ...ctx, actorId: null, userRole: null })).toBeNull()
  })
  it('the requester stays the requester even if the same person is a manager', () => {
    expect(roleOnTicket({ ...ctx, actorId: 'r', userRole: 'manager' })).toBe('Requester')
  })
})

describe('carried through the notification data', () => {
  it('round trip, with "(you)" worked out for the reader', () => {
    const data = partyData({ requesterName: 'Rahul Sharma', technicianName: 'Amit Verma', requesterId: 'r', technicianId: 't', readerId: 't', actorRole: 'Requester' })
    expect(partiesFromData(data)).toEqual({ requesterName: 'Rahul Sharma', technicianName: 'Amit Verma', requesterIsYou: false, technicianIsYou: true })
    expect(data.partyActorRole).toBe('Requester')
  })
  it('data without the block gives no block', () => {
    expect(partiesFromData({ title: 'x' })).toBeUndefined()
  })
})

describe('the e-mails', () => {
  const data = (readerIsRequester: boolean, extra: Record<string, string> = {}) => ({
    title: 'Printer jam', requestNo: 'CKSD-000123', requestTitle: 'Printer jam', link: '/requests/abc', actorName: 'Amit Verma',
    ...partyData({ requesterName: 'Rahul Sharma', technicianName: 'Amit Verma', requesterId: 'r', technicianId: 't', readerId: readerIsRequester ? 'r' : 't', actorRole: 'Technician' }),
    ...extra,
  })
  const types = ['request_created', 'status_changed', 'request_reopened', 'comment_added', 'internal_note_added', 'mentioned', 'request_assigned', 'request_reassigned', 'request_unassigned',
    'approval_approved', 'approval_rejected', 'sla_warning', 'sla_breached', 'request_resolved', 'request_closed', 'request_cancelled', 'request_auto_closed', 'priority_changed', 'collaborator_added', 'approval_requested'] as const

  it.each(types)('%s: the requester gets the block with the technician in it (HTML and text)', async (type) => {
    await sendNotificationEmail({ type, recipientEmail: 'rahul@example.com', recipientName: 'Rahul', data: data(true, type === 'request_assigned' || type === 'request_reassigned' ? { audience: 'requester', assigneeName: 'Amit Verma' } : type === 'approval_requested' ? { audience: 'requester' } : {}) })
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain('Rahul Sharma (you)')
    expect(sent[0].html).toContain('Amit Verma')
    expect(sent[0].text).toContain('Requester: Rahul Sharma (you)')
    expect(sent[0].text).toContain('Technician: Amit Verma')
  })

  it.each(types)('%s: the technician gets the block with the requester in it', async (type) => {
    await sendNotificationEmail({ type, recipientEmail: 'amit@example.com', recipientName: 'Amit', data: data(false, type === 'approval_requested' ? { title: 'Approval requested' } : {}) })
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain('Technician')
    expect(sent[0].html).toContain('Amit Verma (you)')
    expect(sent[0].html).toContain('Rahul Sharma')
    expect(sent[0].html).not.toContain('Rahul Sharma (you)')
  })

  it('a comment shows the role of whoever wrote it; a status change says "by name (role)"', async () => {
    await sendNotificationEmail({ type: 'comment_added', recipientEmail: 'rahul@example.com', recipientName: 'Rahul', data: data(true, { commenterName: 'Amit Verma', commentBody: 'Part ordered.' }) })
    expect(sent[0].html).toContain('Amit Verma (Technician)')
    expect(sent[0].text).toContain('Amit Verma (Technician) commented on')
    sent.length = 0
    await sendNotificationEmail({ type: 'status_changed', recipientEmail: 'rahul@example.com', recipientName: 'Rahul', data: data(true, { oldStatus: 'Open', newStatus: 'In Progress' }) })
    expect(sent[0].html).toMatch(/to <strong>In Progress<\/strong> by <strong>Amit Verma \(Technician\)<\/strong>/)
    expect(sent[0].text).toContain('to In Progress by Amit Verma (Technician)')
  })

  it('a ticket with no technician says so', async () => {
    await sendNotificationEmail({ type: 'request_created', recipientEmail: 'rahul@example.com', recipientName: 'Rahul', data: { title: 'x', serviceName: 'IT', link: '/r', ...partyData({ requesterName: 'Rahul Sharma', technicianName: null, requesterId: 'r', readerId: 'r' }) } })
    expect(sent[0].html).toContain('Not assigned yet')
    expect(sent[0].text).toContain('Technician: Not assigned yet')
  })

  it('the approver sees both names and who sent it on', async () => {
    await sendNotificationEmail({ type: 'approval_requested', recipientEmail: 'suresh@example.com', recipientName: 'Suresh', data: { ...data(false), title: 'Approval requested', actorName: 'Priya Nair' } })
    // (the reader here is neither the requester nor the technician: no "(you)")
    sent.length = 0
    const d = { title: 'x', requestNo: 'CKSD-1', requestTitle: 'x', link: '/r', actorName: 'Amit Verma', requesterName: 'Rahul Sharma', ...partyData({ requesterName: 'Rahul Sharma', technicianName: 'Amit Verma', requesterId: 'r', technicianId: 't', readerId: 'someone-else', actorRole: 'Technician' }) }
    await sendNotificationEmail({ type: 'approval_requested', recipientEmail: 'suresh@example.com', recipientName: 'Suresh', data: d })
    expect(sent[0].html).toContain('Sent for approval by')
    expect(sent[0].html).not.toContain('(you)')
    expect(sent[0].text).toContain('Requester: Rahul Sharma')
    expect(sent[0].text).toContain('Sent for approval by: Amit Verma')
  })

  it('mails that are not about a ticket (a task) get no block', async () => {
    await sendNotificationEmail({ type: 'task_assigned', recipientEmail: 'a@example.com', recipientName: 'A', data: { title: 'Do it', link: '/tasks/1' } })
    expect(sent[0].html).not.toContain('Requester')
  })

  it('the subject is unchanged', async () => {
    await sendNotificationEmail({ type: 'comment_added', recipientEmail: 'rahul@example.com', recipientName: 'Rahul', data: data(true, { commentBody: 'x' }) })
    expect(sent[0].subject).toBe('New comment on: CKSD-000123 — Printer jam')
  })
})

describe('templates called directly', () => {
  it('without the block they are exactly as before', () => {
    const a = requestCreatedEmail({ requesterName: 'R', requestTitle: 'T', requestUrl: 'http://x', serviceName: 'S' })
    expect(a.html).not.toContain('Technician')
    const c = commentAddedEmail({ recipientName: 'R', requestTitle: 'T', requestUrl: 'http://x', commenterName: 'A', commentBody: 'b' })
    expect(c.html).toContain('<strong>A</strong> left a comment')
  })
})

describe('the rating mails', () => {
  const base = { recipientName: 'Rahul', requestNo: 'CKSD-000123', requestTitle: 'Printer jam', requestUrl: 'http://x', starUrls: ['1', '2', '3', '4', '5'], reopenUrl: 'http://r', reopenUntil: '22 Nov', parties: { requesterName: 'Rahul Sharma', technicianName: 'Amit Verma', requesterIsYou: true } }
  it('"resolved" names who resolved it with their role, and shows the block', () => {
    const m = csatResolvedEmail({ ...base, resolutionNote: 'Replaced.', resolverName: 'Amit Verma', resolverRole: 'Technician', resolvedOn: '19 Nov' })
    expect(m.html).toContain('resolved</strong> by Amit Verma (Technician)')
    expect(m.html).toContain('Rahul Sharma (you)')
    expect(m.text).toContain('marked resolved by Amit Verma (Technician)')
    expect(m.text).toContain('Technician: Amit Verma')
  })
  it('"resolved" by an automatic rule has no role', () => {
    const m = csatResolvedEmail({ ...base, resolutionNote: '', resolverName: 'an automatic rule', resolvedOn: '' })
    expect(m.html).toContain('by an automatic rule')
    expect(m.html).not.toContain('(Technician)')
  })
  it('the reminder names the technician who handled it, and shows the block', () => {
    const m = csatReminderEmail(base)
    expect(m.html).toContain('(handled by <strong>Amit Verma</strong>)')
    expect(m.html).toContain('Rahul Sharma (you)')
    expect(m.text).toContain('(handled by Amit Verma)')
  })
  it('without a block they are exactly as before', () => {
    const m = csatReminderEmail({ ...base, parties: undefined })
    expect(m.html).not.toContain('handled by')
  })
})

describe('the daily approval reminder', () => {
  const item = { requestNo: 'CKSD-000123', requestTitle: 'Printer jam', requesterName: 'Rahul Sharma', sentByName: 'Amit Verma', waitingDays: 2, requestUrl: 'http://x' }
  it('each row names the technician', () => {
    const m = approvalReminderEmail({ approverName: 'Suresh', approvalsUrl: 'http://a', items: [{ ...item, technicianName: 'Amit Verma' }, { ...item, requestNo: 'CKSD-000124', technicianName: null }] })
    expect(m.html).toContain('raised by Rahul Sharma · technician Amit Verma · sent by Amit Verma')
    expect(m.html).toContain('technician not assigned yet')
    expect(m.text).toContain('raised by Rahul Sharma, technician Amit Verma, waiting 2 days')
  })
  it('a row whose technician is not known is shown as before', () => {
    const m = approvalReminderEmail({ approverName: 'Suresh', approvalsUrl: 'http://a', items: [item] })
    expect(m.html).not.toContain('technician')
  })
})
