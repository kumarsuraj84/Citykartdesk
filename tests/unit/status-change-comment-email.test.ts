import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { subject: string; html: string; text: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { subject: string; html: string; text: string }) => { sent.push(p); return {} }),
}))

import { sendNotificationEmail } from '@/lib/email/notify-email'

beforeEach(() => { sent.length = 0; process.env.NEXT_PUBLIC_APP_URL = 'http://app.test' })

describe('status-change email includes the technician\'s comment', () => {
  it('shows the comment when one was given', async () => {
    await sendNotificationEmail({
      type: 'status_changed', recipientEmail: 'ankur@example.com', recipientName: 'Ankur',
      data: { requestNo: 'CKSD-000001', requestTitle: 'Printer jam', oldStatus: 'In Progress', newStatus: 'Waiting for User', comment: 'Please confirm the printer model.', link: '/requests/1' },
    })
    expect(sent[0].html).toContain('Please confirm the printer model.')
    expect(sent[0].text).toContain('Please confirm the printer model.')
    expect(sent[0].html).toContain('In Progress')
    expect(sent[0].html).toContain('Waiting for User')
  })

  it('has no empty comment block when none was given', async () => {
    await sendNotificationEmail({
      type: 'status_changed', recipientEmail: 'ankur@example.com', recipientName: 'Ankur',
      data: { requestTitle: 'Printer jam', oldStatus: 'Open', newStatus: 'In Progress', link: '/requests/1' },
    })
    expect(sent[0].html).not.toContain('undefined')
  })

  it('escapes a comment containing markup', async () => {
    await sendNotificationEmail({
      type: 'status_changed', recipientEmail: 'ankur@example.com', recipientName: 'Ankur',
      data: { requestTitle: 'T', oldStatus: 'Open', newStatus: 'In Progress', comment: '<img src=x onerror=alert(1)>', link: '/requests/1' },
    })
    expect(sent[0].html).not.toContain('<img src=x')
  })
})
