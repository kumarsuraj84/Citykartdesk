import { describe, it, expect } from 'vitest'
import { oemSentComment } from '@/lib/requests/oem-message'

describe('what the conversation shows when a ticket is e-mailed to an OEM', () => {
  it('keeps the short line and adds the subject the OEM sees, who it went to, and the whole message', () => {
    const c = oemSentComment({ oemName: 'Blue Star OEM', emails: ['a@bs.com', 'b@bs.com'], subject: 'New AC Issue Ticket — CKSD-000243', requestNo: 'CKSD-000243', body: '  Dear Team,\n\nTicket No: CKSD-000243\nIssue: AC not cooling\n' })
    expect(c.split('\n')[0]).toBe('Ticket sent to Blue Star OEM (a@bs.com, b@bs.com) for servicing.')
    expect(c).toContain('Subject: [CKSD-000243] New AC Issue Ticket — CKSD-000243')
    expect(c).toContain('To: a@bs.com, b@bs.com')
    expect(c.endsWith('Dear Team,\n\nTicket No: CKSD-000243\nIssue: AC not cooling')).toBe(true)
  })
  it('does not tag the subject twice when it already carries the ticket tag', () => {
    expect(oemSentComment({ oemName: 'X', emails: ['a@x.com'], subject: '[CKSD-000243] Hello', requestNo: 'CKSD-000243', body: 'b' })).toContain('Subject: [CKSD-000243] Hello\n')
  })
})
