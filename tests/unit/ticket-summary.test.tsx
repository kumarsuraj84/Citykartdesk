// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { buildTicketSummary, ago, type SummaryInput } from '@/lib/requests/ticket-summary'
import { TicketSummaryCard } from '@/components/requests/TicketSummaryCard'

afterEach(() => cleanup())

const now = new Date('2026-10-15T12:00:00+05:30')
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString()
const base: SummaryInput = {
  now, ticketNo: 'CKSD-000123', title: 'Printer not working', status: 'in_progress', priority: 'medium', createdAt: at(50), requester: 'Store JML', technician: 'Arvind', group: 'IT GROUP',
  respondedAt: at(48), responseDueAt: at(40), resolutionDueAt: at(-10), resolvedAt: null, waitingSince: null, comments: [], activity: [], approvals: [], attachmentCount: 0,
}

describe('ticket summary ("catch me up")', () => {
  it('says who has it, how old it is, and what is pending', () => {
    const s = buildTicketSummary(base)
    expect(s.headline).toBe('CKSD-000123 is In Progress, Medium priority, with Arvind (IT GROUP). Raised by Store JML 2 days ago.')
    expect(s.pending).toContain('Arvind has to work on it and resolve it.')
    expect(s.pending).toContain('Resolution is due in 10 hours.')
  })

  it('a ticket nobody has is called out, and an overdue one says by how much', () => {
    const s = buildTicketSummary({ ...base, technician: null, group: null, respondedAt: null, resolutionDueAt: at(43) })
    expect(s.headline).toContain('not assigned to a technician yet')
    expect(s.pending).toContain('Nobody is assigned yet: it needs a technician.')
    expect(s.pending.some((p) => p.startsWith('No response has been given yet and the response time is already over by'))).toBe(true)
    expect(s.pending).toContain('Resolution time is over by 43 hours (SLA breached).')
  })

  it('tells the story: assignment, status moves, replies (internal notes only counted), the last public message', () => {
    const s = buildTicketSummary({
      ...base, attachmentCount: 2,
      activity: [
        { at: at(49), action: 'assigned', actor: 'System' },
        { at: at(47), action: 'status_changed', actor: 'Arvind', from: 'open', to: 'in_progress' },
      ],
      comments: [
        { at: at(46), author: 'Arvind', internal: false, byRequester: false, body: 'Please share the printer model number.' },
        { at: at(45), author: 'Arvind', internal: true, byRequester: false, body: 'secret internal detail: driver issue' },
        { at: at(30), author: 'Store JML', internal: false, byRequester: true, body: 'It is HP LaserJet 1020' },
      ],
    })
    const text = s.happened.join('\n')
    expect(text).toContain('Raised by Store JML, 2 days ago with 2 attachments.')
    expect(text).toContain('Assigned to Arvind 2 days ago.')
    expect(text).toContain('Status moved: Open → In Progress')
    expect(text).toContain('2 public replies and 1 internal note so far.')
    expect(text).toContain('Last public message, yesterday, from Store JML')
    expect(text).toContain('"It is HP LaserJet 1020"')
    expect(text).not.toContain('secret internal detail')                                // internal notes are never quoted
    expect(s.pending).toContain("Store JML's last message has no reply yet.")           // the requester wrote last
  })

  it('waiting on the user, on hold, and waiting for approval each say who and since when', () => {
    expect(buildTicketSummary({ ...base, status: 'waiting_user', waitingSince: at(72) }).pending).toContain('Waiting for Store JML to reply since 3 days ago.')
    expect(buildTicketSummary({ ...base, status: 'hold_purchase_ho', waitingSince: at(5) }).pending).toContain('On hold for a purchase from HO since 5 hours ago.')
    const s = buildTicketSummary({ ...base, status: 'pending_approval', approvals: [{ status: 'pending', sentAt: at(26), awaiting: ['Ankur', 'Bela'] }] })
    expect(s.pending).toContain('Waiting for approval from Ankur and Bela, sent yesterday.')
    expect(s.happened).toContain('Sent for approval yesterday to Ankur and Bela.')
  })

  it('a decided approval is part of what happened; a finished ticket has nothing pending', () => {
    const done = buildTicketSummary({ ...base, status: 'resolved', resolvedAt: at(2), resolutionDueAt: null, approvals: [{ status: 'approved', sentAt: at(20), awaiting: [], decidedBy: 'Ankur', decision: 'approved' }] })
    expect(done.happened).toContain('Approval approved by Ankur.')
    expect(done.happened).toContain('Resolved 2 hours ago.')
    expect(done.pending).toEqual(['Resolved: nothing more is needed unless Store JML reopens it.'])
    expect(buildTicketSummary({ ...base, status: 'closed', resolutionDueAt: null }).pending).toEqual(['Nothing: this ticket is finished.'])
  })

  it('times read in plain words', () => {
    expect(ago(at(0.01), now)).toBe('just now')
    expect(ago(at(0.5), now)).toBe('30 minutes ago')
    expect(ago(at(1), now)).toBe('1 hour ago')
    expect(ago(at(24), now)).toBe('yesterday')
    expect(ago(at(24 * 6), now)).toBe('6 days ago')
  })

  it('the card shows both sections', () => {
    render(<TicketSummaryCard summary={buildTicketSummary(base)} />)
    expect(screen.getByText('Catch me up')).toBeTruthy()
    expect(screen.getByText('What happened so far')).toBeTruthy()
    expect(screen.getByText('What is pending')).toBeTruthy()
  })
})
