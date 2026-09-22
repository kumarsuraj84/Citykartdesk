import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { to: string; subject: string; html: string; text: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string; text: string }) => { sent.push(p); return {} }),
}))

import { sendNotificationEmail, absoluteAppUrl } from '@/lib/email/notify-email'
import { ALL_NOTIFICATION_EVENT_TYPES } from '@/lib/constants/notification-rules'

beforeEach(() => {
  sent.length = 0
  process.env.NEXT_PUBLIC_APP_URL = 'http://182.72.84.10:3210'
})

describe('notification emails', () => {
  // The Notification Rules screen lets an admin tick "Email" for every event in this
  // catalog. If one has no email template, that tick silently does nothing.
  it.each(ALL_NOTIFICATION_EVENT_TYPES)('%s: ticking Email actually sends an email', async (type) => {
    const res = await sendNotificationEmail({
      type,
      recipientEmail: 'a@example.com',
      recipientName: 'Asha',
      data: { title: 'AC not cooling', body: 'details', link: '/requests/abc' },
    })
    expect(res.skipped, `no email template for "${type}"`).toBeUndefined()
    expect(res.error).toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('a@example.com')
  })

  it('turns app-relative links into full addresses (a relative link is dead inside an email)', async () => {
    await sendNotificationEmail({
      type: 'request_created', recipientEmail: 'a@example.com', recipientName: 'Asha',
      data: { title: 'AC not cooling', link: '/requests/abc?tab=approvals' },
    })
    expect(sent[0].html).toContain('href="http://182.72.84.10:3210/requests/abc?tab=approvals"')
    expect(sent[0].text).toContain('http://182.72.84.10:3210/requests/abc?tab=approvals')
    expect(sent[0].html).not.toContain('href="/requests')
  })

  it('never greets "Hi ,"', async () => {
    await sendNotificationEmail({ type: 'status_changed', recipientEmail: 'a@example.com', recipientName: '', data: { title: 'T', link: '/requests/1' } })
    expect(sent[0].html).toContain('Hi there,')
    expect(sent[0].html).not.toContain('Hi ,')
  })

  it('reports a send failure instead of swallowing it', async () => {
    const { sendEmail } = await import('@/lib/email/send')
    vi.mocked(sendEmail).mockResolvedValueOnce({ error: 'smtp down' })
    const res = await sendNotificationEmail({ type: 'request_created', recipientEmail: 'a@example.com', recipientName: 'A', data: { title: 'T', link: '/requests/1' } })
    expect(res.error).toBe('smtp down')
  })

  it('leaves full links and empty links alone', () => {
    expect(absoluteAppUrl('https://x.test/a')).toBe('https://x.test/a')
    expect(absoluteAppUrl(undefined)).toBe('')
  })

  it('escapes user-controlled text in the new generic template', async () => {
    await sendNotificationEmail({ type: 'request_resolved', recipientEmail: 'a@example.com', recipientName: 'A', data: { title: '<img src=x onerror=alert(1)>', link: '/requests/1' } })
    expect(sent[0].html).not.toContain('<img src=x')
  })
})

describe('resolved/closed/cancelled emails show the technician\'s comment (not just the generic sentence)', () => {
  it('resolved: prefers the real comment over the generic "marked it resolved" body', async () => {
    const res = await sendNotificationEmail({
      type: 'request_resolved', recipientEmail: 'a@example.com', recipientName: 'Ankur',
      data: { title: 'Printer jam', link: '/requests/1', body: 'Ajay marked it resolved.', comment: 'Replaced the toner cartridge and ran a test print.' },
    })
    expect(res.error).toBeUndefined()
  })

  it('falls back to the generic sentence when no comment was given', async () => {
    const { sendEmail } = await import('@/lib/email/send')
    vi.mocked(sendEmail).mockClear()
    await sendNotificationEmail({
      type: 'request_resolved', recipientEmail: 'a@example.com', recipientName: 'Ankur',
      data: { title: 'Printer jam', link: '/requests/1', body: 'Ajay marked it resolved.' },
    })
    const call = vi.mocked(sendEmail).mock.calls.at(-1)![0]
    expect(call.html).toContain('Ajay marked it resolved.')
  })

  it('the comment actually appears in the sent email body', async () => {
    const { sendEmail } = await import('@/lib/email/send')
    vi.mocked(sendEmail).mockClear()
    await sendNotificationEmail({
      type: 'request_resolved', recipientEmail: 'a@example.com', recipientName: 'Ankur',
      data: { title: 'Printer jam', link: '/requests/1', body: 'Ajay marked it resolved.', comment: 'Replaced the toner cartridge and ran a test print.' },
    })
    const call = vi.mocked(sendEmail).mock.calls.at(-1)![0]
    expect(call.html).toContain('Replaced the toner cartridge and ran a test print.')
    expect(call.text).toContain('Replaced the toner cartridge and ran a test print.')
  })
})
