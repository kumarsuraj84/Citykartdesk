import { describe, it, expect } from 'vitest'
import { approvalRequiredEmail, approvalRequestSentence } from '@/lib/email/templates'

const base = { approverName: 'Ankur', requestTitle: 'CKSD-000140 - HP printer Cartridge Not Working', requestUrl: 'http://app.test/requests/1' }

describe('the approval e-mail names who logged the request and who sent it for approval', () => {
  it('technician sent it: both names, requester first', () => {
    const m = approvalRequiredEmail({ ...base, requesterName: 'LMD', senderName: 'Kaushlesh', kind: 'new' })
    expect(m.html).toContain('Hi Ankur,')
    expect(m.html).toContain('<strong>LMD</strong> has submitted the request <strong>CKSD-000140 - HP printer Cartridge Not Working</strong>, and <strong>Kaushlesh</strong> sent it to you for approval. Please check and approve it.')
    expect(m.text).toContain('LMD has submitted the request CKSD-000140 - HP printer Cartridge Not Working, and Kaushlesh sent it to you for approval. Please check and approve it.')
    expect(m.subject).toBe('Approval required: CKSD-000140 - HP printer Cartridge Not Working')
  })

  it('the requester sent their own request: one name, in both roles', () => {
    const m = approvalRequiredEmail({ ...base, requesterName: 'LMD', senderName: 'lmd', kind: 'new' })
    expect(m.html).toContain('<strong>LMD</strong> has submitted the request')
    expect(m.html).toContain('and sent it to you for approval')
    expect(m.html).not.toContain('and <strong>lmd</strong>')
  })

  it('never prints an empty name or a half sentence when a name is missing', () => {
    expect(approvalRequestSentence({ requestTitle: 'T', requesterName: 'LMD' }, (s) => s)).toBe('LMD has submitted the request T and it needs your approval. Please check and approve it.')
    expect(approvalRequestSentence({ requestTitle: 'T', senderName: 'Kaushlesh' }, (s) => s)).toBe('Kaushlesh has sent you the request T for approval. Please check and approve it.')
    expect(approvalRequestSentence({ requestTitle: 'T' }, (s) => s)).toBe('The request T needs your approval. Please check and approve it.')
    expect(approvalRequestSentence({ requestTitle: 'T', requesterName: '  ', senderName: '' }, (s) => s)).not.toMatch(/\s{2}|^ /)
  })

  it('a later approval step and a hand-over read correctly too', () => {
    expect(approvalRequestSentence({ requestTitle: 'T', requesterName: 'LMD', senderName: 'Ravi', kind: 'next_step' }, (s) => s))
      .toBe('The request T raised by LMD now needs your approval; Ravi has approved the step before yours. Please check and approve it.')
    expect(approvalRequestSentence({ requestTitle: 'T', requesterName: 'LMD', senderName: 'Ravi', kind: 'delegated' }, (s) => s))
      .toBe('Ravi has passed the approval of the request T (raised by LMD) to you. Please check and approve it.')
  })

  it('escapes names and titles, so text from a ticket cannot add markup', () => {
    const m = approvalRequiredEmail({ ...base, requestTitle: 'CKSD-1 - <b>x</b>', requesterName: '<i>LMD</i>', senderName: 'Kaushlesh', kind: 'new' })
    expect(m.html).not.toContain('<i>LMD</i>')
    expect(m.html).not.toContain('<b>x</b>')
    expect(m.html).toContain('&lt;i&gt;LMD&lt;/i&gt;')
  })
})
