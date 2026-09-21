/**
 * Password-reset / invitation emails now go through the app's own mailbox.
 * Against the real local auth server: the emailed link must work exactly once, the
 * page must not use the token on GET (mail scanners), and unknown addresses must not
 * reveal anything.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { setupD03Fixtures, type D03Fixtures } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string }[] = []
let mailboxConfigured = true

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/config', () => ({
  getEmailSetup: vi.fn(async () => (mailboxConfigured ? { provider: 'smtp' } : { provider: null })),
}))
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string }) => { sent.push(p); return {} }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { emailPasswordResetLink } from '@/lib/email/auth-mail'
import { GET, POST } from '@/app/auth/confirm/route'

const anon = () => createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function linkFromLastEmail(): URL {
  const html = sent[sent.length - 1].html
  const href = /href="([^"]+auth\/confirm[^"]+)"/.exec(html)![1].replace(/&amp;/g, '&')
  return new URL(href)
}

describe('emailed password-reset link', () => {
  let fx: D03Fixtures
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  it('refuses with a clear message when no mailbox is configured, and sends nothing', async () => {
    mailboxConfigured = false
    sent.length = 0
    const r = await emailPasswordResetLink(fx.requesterA.email)
    expect(r.error).toMatch(/not set up/i)
    expect(sent).toHaveLength(0)
    mailboxConfigured = true
  })

  it('sends one email to the user containing a confirm link', async () => {
    sent.length = 0
    expect(await emailPasswordResetLink(fx.requesterA.email)).toEqual({})
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(fx.requesterA.email.toLowerCase())
    const url = linkFromLastEmail()
    expect(url.origin).toBe('http://app.test')
    expect(url.pathname).toBe('/auth/confirm')
    expect(url.searchParams.get('type')).toBe('recovery')
  })

  it('reports success but sends nothing for an address with no account', async () => {
    sent.length = 0
    expect(await emailPasswordResetLink(`nobody-${Date.now()}@example.com`)).toEqual({})
    expect(sent).toHaveLength(0)
  })

  it('GET only shows a button (does not use the token); POST signs the user in once', async () => {
    sent.length = 0
    await emailPasswordResetLink(fx.requesterA.email)
    const url = linkFromLastEmail()

    const page = await GET(new Request(url.toString()))
    const html = await page.text()
    expect(html).toContain('method="POST"')

    const client = anon()
    vi.mocked(createClient).mockResolvedValue(client as never)
    const form = () => {
      const fd = new FormData()
      fd.set('token_hash', url.searchParams.get('token_hash')!)
      fd.set('type', 'recovery')
      fd.set('next', '/reset-password')
      return new Request('http://app.test/auth/confirm', { method: 'POST', body: fd })
    }

    // The scanner-style GET above did not consume it, so the real click still works:
    const ok = await POST(form())
    expect(ok.status).toBe(303)
    expect(ok.headers.get('location')).toBe('http://app.test/reset-password')
    const { data } = await client.auth.getUser()
    expect(data.user?.email?.toLowerCase()).toBe(fx.requesterA.email.toLowerCase())

    // ...and a second use is rejected.
    vi.mocked(createClient).mockResolvedValue(anon() as never)
    const again = await POST(form())
    expect(again.headers.get('location')).toContain('/forgot-password?expired=1')
  })

  it('will not redirect to another site via next=', async () => {
    const page = await GET(new Request('http://app.test/auth/confirm?token_hash=abc&type=recovery&next=//evil.com'))
    expect(await page.text()).toContain('value="/reset-password"')
  })
})
