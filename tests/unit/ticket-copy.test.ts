import { describe, it, expect } from 'vitest'
import { validateCc, searchCcBook, isEmailShape, MAX_CC, type CcBook, type CcContact } from '@/lib/requests/cc-recipients'
import { ticketCopyEmail } from '@/lib/email/ticket-copy-template'
import type { TicketPdfModel } from '@/lib/requests/ticket-pdf-model'

const user = (email: string, name: string, profileId: string, detail = 'Manager'): CcContact => ({ email, name, kind: 'user', detail, profileId })
const book: CcBook = new Map([
  ['asha@citykart.org', user('asha@citykart.org', 'Asha Mehta', 'p-asha')],
  ['ravi@citykart.org', user('ravi@citykart.org', 'Ravi Kumar', 'p-ravi', 'Technician')],
  ['requester@citykart.org', user('requester@citykart.org', 'Store JHM', 'p-req', 'User')],
  ['me@citykart.org', user('me@citykart.org', 'Ayush Rawat', 'p-me', 'Technician')],
  ['service@daikin.test', { email: 'service@daikin.test', name: 'DAIKIN', kind: 'oem', detail: 'OEM contact' }],
])
const who = { requesterId: 'p-req', actorId: 'p-me' }

describe('who can be copied', () => {
  it('accepts CK Desk users and OEM contacts, in any letter case', () => {
    const { accepted, rejected } = validateCc(['Asha@Citykart.org', ' service@daikin.test '], book, who)
    expect(accepted.map((c) => c.email)).toEqual(['asha@citykart.org', 'service@daikin.test'])
    expect(rejected).toEqual([])
  })

  it('refuses an outsider address, a malformed one, the requester and the sender', () => {
    const { accepted, rejected } = validateCc(['someone@gmail.com', 'not-an-email', 'requester@citykart.org', 'me@citykart.org', 'ravi@citykart.org'], book, who)
    expect(accepted.map((c) => c.email)).toEqual(['ravi@citykart.org'])
    expect(Object.fromEntries(rejected.map((r) => [r.email, r.reason]))).toMatchObject({
      'someone@gmail.com': expect.stringMatching(/Not a CK Desk address/),
      'not-an-email': expect.stringMatching(/valid/),
      'requester@citykart.org': expect.stringMatching(/requester already/),
      'me@citykart.org': expect.stringMatching(/you/i),
    })
  })

  it('counts each address once and stops at the limit', () => {
    const many: CcBook = new Map()
    for (let i = 0; i < 8; i++) many.set(`u${i}@citykart.org`, user(`u${i}@citykart.org`, `User ${i}`, `p${i}`))
    const { accepted, rejected } = validateCc(['u0@citykart.org', 'U0@citykart.org', ...Array.from({ length: 7 }, (_, i) => `u${i + 1}@citykart.org`)], many, who)
    expect(accepted).toHaveLength(MAX_CC)
    expect(rejected.every((r) => /At most/.test(r.reason))).toBe(true)
  })

  it('suggests by name or address, exact address first, and needs two letters', () => {
    expect(searchCcBook(book, 'a')).toEqual([])
    expect(searchCcBook(book, 'rav').map((c) => c.name)).toEqual(['Ravi Kumar'])
    expect(searchCcBook(book, 'daikin').map((c) => c.kind)).toEqual(['oem'])
    expect(searchCcBook(book, 'service@daikin.test')[0].email).toBe('service@daikin.test')
    expect(isEmailShape('a@b.co')).toBe(true)
    expect(isEmailShape('a@b')).toBe(false)
  })
})

const model: TicketPdfModel = {
  requestNo: 'CKSD-000169', title: 'SAVIOR CARD <FOR> TEMP STAFF', status: 'Open', priority: 'Medium', generatedAt: 'x', generatedBy: 'x',
  details: [{ label: 'Requester', value: 'LBK' }, { label: 'Technician', value: 'Ayush Rawat' }, { label: 'Technician group', value: 'HR GROUP' }, { label: 'Service', value: 'HR' }, { label: 'Category', value: 'SAVIOR/BIOMAX' }, { label: 'Created', value: '09 Oct 2026' }, { label: 'Resolution due', value: '10 Oct 2026' }, { label: 'Resolved', value: '-' }],
  submitted: [], description: '', approvals: [], history: [], csat: null,
  attachments: [{ name: 'NA.jpg', size: '11 KB', by: 'LBK', at: 'x' }],
  conversation: [
    { id: 'c1', author: 'LBK', at: '09 Oct 2026, 1:34 pm', body: 'Please provide savior card for temp staff.', via: '' },
    { id: 'c2', author: 'Ayush Rawat', at: '09 Oct 2026, 3:10 pm', body: 'Card will be issued <b>tomorrow</b>.\nSecond line.', via: '' },
  ],
}

describe('the copy e-mail', () => {
  const mail = ticketCopyEmail({ recipientName: 'Asha', copiedBy: 'Ayush Rawat', model, newCommentId: 'c2', requestUrl: 'http://app.test/requests/1', pdfAttached: true })

  it('carries the ticket, the whole conversation and the new comment marked as new', () => {
    expect(mail.subject).toBe('CKSD-000169: SAVIOR CARD <FOR> TEMP STAFF (copied by Ayush Rawat)')
    expect(mail.html).toContain('Please provide savior card for temp staff.')
    expect(mail.html).toContain('Card will be issued')
    expect(mail.html).toContain('NEW')
    expect(mail.html).toContain('Latest comment')
    expect(mail.html).toContain('Complete conversation (2)')
    expect(mail.html).toContain('HR GROUP')
    expect(mail.html).toContain('NA.jpg')
    expect(mail.html).toContain('attached as a PDF')
    expect(mail.text).toContain('[NEW]')
    expect(mail.text).toContain('Please provide savior card')
  })

  it('escapes everything it prints, so text from a ticket cannot add markup', () => {
    expect(mail.html).not.toContain('<FOR>')
    expect(mail.html).not.toContain('<b>tomorrow</b>')
    expect(mail.html).toContain('&lt;b&gt;tomorrow&lt;/b&gt;')
    expect(mail.html).toContain('<br>')
  })

  it('says nothing about a PDF when none is attached, and trims a very long conversation to the latest messages', () => {
    const long: TicketPdfModel = { ...model, conversation: Array.from({ length: 90 }, (_, i) => ({ id: `m${i}`, author: 'A', at: 't', body: `message ${i}`, via: '' })) }
    const m2 = ticketCopyEmail({ recipientName: 'Asha', copiedBy: 'X', model: long, newCommentId: 'm89', requestUrl: 'u', pdfAttached: false })
    expect(m2.html).not.toContain('attached as a PDF')
    expect(m2.html).toContain('Showing the latest 60 of 90')
    expect(m2.html).toContain('message 89')
    expect(m2.html).not.toContain('message 5<')
  })
})
