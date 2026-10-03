/**
 * An OEM with 10 email addresses used to get 10 separate emails (one sendEmail() per
 * address). It must be ONE email addressed to all of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendEmailMock, sendMailMock, fetchMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn().mockResolvedValue({}),
  sendMailMock: vi.fn().mockResolvedValue({}),
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/email/send', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/email/send')>()), sendEmail: sendEmailMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/notifications', () => ({ notify: vi.fn() }))

const emails = Array.from({ length: 10 }, (_, i) => `oem${i + 1}@vendor.com`)

function fakeAdmin(bodyTemplate: string | null = null) {
  const chain = (result: unknown) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'update', 'insert']) b[m] = () => b
    b.maybeSingle = async () => ({ data: result })
    b.then = (resolve: (v: unknown) => void) => resolve({ data: result })
    return b
  }
  return {
    from: (table: string) =>
      table === 'oems'
        ? chain({ name: 'Blue Star', emails, email_subject_template: null, email_body_template: bodyTemplate, is_active: true })
        : chain(null),
  }
}

describe('OEM auto-routing email', () => {
  beforeEach(() => sendEmailMock.mockClear())

  it('sends ONE email to all 10 OEM addresses, not 10 emails', async () => {
    const { runOemAutoRouting } = await import('@/lib/requests/create-request-core')
    await runOemAutoRouting({
      admin: fakeAdmin() as never, actorId: 'u1', orgId: 'org-1',
      request: { id: 'r1', request_no: 'CKSD-000001' }, autoOemRouting: true, storeOemId: 'oem-1',
      title: 'AC not cooling', description: 'x', requesterName: 'Store', requesterEmail: 's@x.com', requesterPhone: '1', storeAddress: 'addr',
    })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0][0].to).toEqual(emails)
  })
})

describe('OEM auto-routing email — rich table template', () => {
  beforeEach(() => sendEmailMock.mockClear())

  it('sends the table template filled in, with ticket text escaped, once, to everyone', async () => {
    const { runOemAutoRouting } = await import('@/lib/requests/create-request-core')
    await runOemAutoRouting({
      admin: fakeAdmin('<p>Dear Team,</p><table><tbody><tr><th>Ticket No</th><td>{{ticket_no}}</td></tr><tr><th>Issue</th><td>{{subject}}</td></tr></tbody></table><script>alert(1)</script>') as never,
      actorId: 'u1', orgId: 'org-1', request: { id: 'r1', request_no: 'CKSD-000007' }, autoOemRouting: true, storeOemId: 'oem-1',
      title: '<b>AC</b> down', description: 'x', requesterName: 'Store', requesterEmail: 's@x.com', requesterPhone: '1', storeAddress: 'addr',
    })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const sent = sendEmailMock.mock.calls[0][0]
    expect(sent.to).toEqual(emails)
    expect(sent.html).toContain('<table')
    expect(sent.html).toContain('CKSD-000007')
    expect(sent.html).toContain('&lt;b&gt;AC&lt;/b&gt; down')
    expect(sent.html).not.toMatch(/script/i)
    expect(sent.text).toContain('Ticket No | CKSD-000007')
  })
})

describe('sendEmail with several recipients', () => {
  beforeEach(() => { sendMailMock.mockClear(); fetchMock.mockReset().mockResolvedValue({ ok: true }) })

  async function load(provider: 'smtp' | 'resend') {
    vi.resetModules()
    vi.doMock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: sendMailMock, close: vi.fn() }) } }))
    vi.doMock('@/lib/email/config', () => ({
      getEmailFrom: async () => 'desk@citykart.org',
      getEmailSetup: async () => ({ provider, smtp: { host: 'smtp.x.com', port: 587, secure: false, user: 'u', pass: 'p' } }),
      RESEND_API_KEY: 'key',
    }))
    vi.doMock('@/lib/events/record', () => ({ recordEvents: vi.fn() }))
    vi.stubGlobal('fetch', fetchMock)
    return (await vi.importActual<typeof import('@/lib/email/send')>('@/lib/email/send')).sendEmail
  }

  it('SMTP: one sendMail call carrying every recipient', async () => {
    const send = await load('smtp')
    expect(await send({ to: emails, subject: 's', html: '<p>h</p>' })).toEqual({})
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0][0].to).toEqual(emails)
  })

  it('Resend: one API request with the recipients as a list', async () => {
    const send = await load('resend')
    await send({ to: emails, subject: 's', html: '<p>h</p>' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(emails)
  })

  it('a single address still works as a plain string', async () => {
    const send = await load('smtp')
    await send({ to: 'one@x.com', subject: 's', html: '<p>h</p>' })
    expect(sendMailMock.mock.calls[0][0].to).toBe('one@x.com')
  })
})
