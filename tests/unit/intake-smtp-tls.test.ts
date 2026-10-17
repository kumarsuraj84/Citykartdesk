// Scan finding NEW-001: the intake worker's mail sending must verify the server's certificate and insist on TLS.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const created: Record<string, unknown>[] = []
vi.mock('nodemailer', () => ({ default: { createTransport: (o: Record<string, unknown>) => { created.push(o); return { sendMail: async () => ({ messageId: 'm1' }) } } } }))

import { sendEmail } from '../../api/src/intake/smtp'

describe('intake worker SMTP transport', () => {
  beforeEach(() => { created.length = 0 })
  it('verifies the certificate, requires TLS and refuses old protocol versions', async () => {
    await sendEmail({ host: 'imap.gmail.com', user: 'a@b.test', password: 'x' } as never, { from: 'a@b.test', to: ['c@d.test'], subject: 's', text: 't' } as never)
    expect(created).toHaveLength(1)
    const tls = created[0].tls as { rejectUnauthorized?: boolean; minVersion?: string }
    expect(tls.rejectUnauthorized).toBe(true)
    expect(tls.minVersion).toBe('TLSv1.2')
    expect(created[0].requireTLS).toBe(true)
    expect(created[0].host).toBe('smtp.gmail.com')
  })
  it('does the same for Microsoft 365', async () => {
    await sendEmail({ host: 'outlook.office365.com', user: 'a@b.test', accessToken: 'tok' } as never, { from: 'a@b.test', to: ['c@d.test'], subject: 's', text: 't' } as never)
    expect(created[0].host).toBe('smtp.office365.com')
    expect((created[0].tls as { rejectUnauthorized?: boolean }).rejectUnauthorized).toBe(true)
  })
})
