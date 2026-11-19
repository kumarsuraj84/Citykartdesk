import { describe, it, expect, vi, beforeEach } from 'vitest'

// After a password is set through the e-mailed link, or changed from the profile, the owner of the mailbox is told, other sessions are ended, and a failing mail never blocks the change.
vi.mock('server-only', () => ({}))
const sendEmail = vi.fn()
let configured = true
vi.mock('@/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
vi.mock('@/lib/email/config', () => ({ getEmailSetup: async () => ({ provider: configured ? 'smtp' : null }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { emailPasswordChangedNotice } from '@/lib/email/auth-mail'

beforeEach(() => { sendEmail.mockReset(); sendEmail.mockResolvedValue({}); configured = true })

describe('the "your password was changed" mail', () => {
  it('goes to the account address and says when, how and what to do if it was not them', async () => {
    await emailPasswordChangedNotice('SM.ABC@citykartstores.com', 'reset-link', new Date('2026-11-19T05:30:00Z'))
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const m = sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string; html: string }
    expect(m.to).toBe('sm.abc@citykartstores.com')
    expect(m.subject).toBe('Your Citykart Desk password was changed')
    expect(m.text).toContain('using the password reset link that was e-mailed to you')
    expect(m.text).toContain('19 Nov 2026')
    expect(m.text).toContain('signed out on your other devices')
    expect(m.text).toContain('If it was NOT you, contact IT')
  })

  it('a change made from the profile says so', async () => {
    await emailPasswordChangedNotice('a@b.com', 'changed-by-user')
    expect((sendEmail.mock.calls[0][0] as { text: string }).text).toContain('from your profile')
  })

  it('sends nothing when no mailbox is set up or there is no address, and never throws when sending fails', async () => {
    configured = false
    await emailPasswordChangedNotice('a@b.com', 'reset-link')
    configured = true
    await emailPasswordChangedNotice('', 'reset-link')
    expect(sendEmail).not.toHaveBeenCalled()
    sendEmail.mockRejectedValue(new Error('smtp down'))
    await expect(emailPasswordChangedNotice('a@b.com', 'reset-link')).resolves.toEqual({})
  })
})
