// D-026: the mail server entered in Platform Settings cannot point back at the server itself, and a saved password is never silently reused
// for a different server or login. Real database and Vault; everything it stores is removed again (the isolation gate refuses to run while a
// mailbox is saved on the audit database).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { saveMailboxSettings, clearMailboxSettings } from '@/lib/actions/admin/config'

vi.setConfig({ testTimeout: 60_000 })
let fx: D03Fixtures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = getAdmin() as any
const stored = async () => (await admin.from('email_smtp_settings').select('host, port, username').eq('id', true).maybeSingle()).data

beforeAll(async () => {
  fx = await setupD03Fixtures()
  vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
  expect(await stored()).toBeNull()   // never touch a real configuration
}, 120_000)
afterAll(async () => { await clearMailboxSettings(); await fx?.cleanup() }, 120_000)

describe('mailbox settings (D-026)', () => {
  it('refuses a mail server that is this computer or the metadata address, and stores nothing', async () => {
    for (const host of ['localhost', '127.0.0.1', '169.254.169.254', '0.0.0.0']) {
      const r = await saveMailboxSettings({ host, port: 587, username: 'it@citykart.org', password: 'abcd efgh ijkl mnop' })
      expect(r.error, host).toBeTruthy()
    }
    expect(await stored()).toBeNull()
  })

  it('a saved password is kept while the server and login stay the same, but not reused for a different server or login', async () => {
    expect((await saveMailboxSettings({ host: 'smtp.gmail.com', port: 587, username: 'it@citykart.org', password: 'abcd efgh ijkl mnop' })).error).toBeUndefined()
    // same server, same login, password left empty: fine
    expect((await saveMailboxSettings({ host: 'smtp.gmail.com', port: 587, username: 'it@citykart.org' })).error).toBeUndefined()
    // a different server with the box left empty: refused, the old settings stay
    const moved = await saveMailboxSettings({ host: 'mail.other-provider.example', port: 587, username: 'it@citykart.org' })
    expect(moved.error).toMatch(/enter the mailbox password again/i)
    expect((await saveMailboxSettings({ host: 'smtp.gmail.com', port: 465, username: 'it@citykart.org' })).error).toMatch(/password again/i)
    expect((await saveMailboxSettings({ host: 'smtp.gmail.com', port: 587, username: 'someone.else@citykart.org' })).error).toMatch(/password again/i)
    expect(await stored()).toMatchObject({ host: 'smtp.gmail.com', port: 587, username: 'it@citykart.org' })
    // the new server with a new password is accepted
    expect((await saveMailboxSettings({ host: 'mail.other-provider.example', port: 587, username: 'it@citykart.org', password: 'new password here' })).error).toBeUndefined()
    expect(await stored()).toMatchObject({ host: 'mail.other-provider.example' })
  })
})
