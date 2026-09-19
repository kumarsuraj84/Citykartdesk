/**
 * Mailbox (SMTP) settings — the credential path. The password must round-trip through
 * the encrypted Vault for the server (service_role) only, the settings table must be
 * invisible to ordinary users, and clearing must really remove it.
 *
 * Skips itself when a mailbox is already saved on this database, so it can never
 * overwrite a real configuration.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { loadDbSmtpConfig, invalidateMailboxCache } from '@/lib/email/mailbox'

const admin = getAdmin()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyAdmin = admin as any

async function alreadyConfigured(): Promise<boolean> {
  const { data } = await anyAdmin.from('email_smtp_settings').select('id').maybeSingle()
  const { data: has } = await anyAdmin.rpc('email_smtp_has_password')
  return !!data || has === true
}

describe('mailbox settings storage', async () => {
  const skip = await alreadyConfigured()
  let fx: D03Fixtures

  beforeAll(async () => {
    if (!skip) fx = await setupD03Fixtures()
  }, 90_000)

  afterAll(async () => {
    if (skip) return
    await anyAdmin.rpc('email_smtp_clear_password')
    await anyAdmin.from('email_smtp_settings').delete().eq('id', true)
    invalidateMailboxCache()
    await fx?.cleanup()
  }, 90_000)

  it.skipIf(skip)('stores the password and reads it back for the server', async () => {
    const { error } = await anyAdmin.rpc('email_smtp_store_password', { p_secret: 'abcd efgh ijkl mnop' })
    expect(error).toBeNull()
    expect((await anyAdmin.rpc('email_smtp_has_password')).data).toBe(true)
    expect((await anyAdmin.rpc('email_smtp_read_password')).data).toBe('abcd efgh ijkl mnop')
  })

  it.skipIf(skip)('updating the password replaces it instead of adding a second secret', async () => {
    await anyAdmin.rpc('email_smtp_store_password', { p_secret: 'second-password' })
    expect((await anyAdmin.rpc('email_smtp_read_password')).data).toBe('second-password')
  })

  it.skipIf(skip)('loadDbSmtpConfig() returns the saved mailbox with its password', async () => {
    await anyAdmin.from('email_smtp_settings').upsert({ id: true, host: 'smtp.gmail.com', port: 587, username: 'desk@example.com' }, { onConflict: 'id' })
    invalidateMailboxCache()
    expect(await loadDbSmtpConfig()).toEqual({
      host: 'smtp.gmail.com', port: 587, secure: false, user: 'desk@example.com', pass: 'second-password', fromAddress: null,
    })
  })

  it.skipIf(skip)('a normal logged-in user can neither read the password nor the settings', async () => {
    const user = clientForToken(fx.agentA.accessToken)
    const { data: pw, error } = await user.rpc('email_smtp_read_password' as never)
    expect(pw).toBeNull()
    expect(error).not.toBeNull()

    const { data: rows } = await user.from('email_smtp_settings' as never).select('*')
    expect(rows ?? []).toHaveLength(0)
  })

  it.skipIf(skip)('clearing removes the password and the settings', async () => {
    await anyAdmin.rpc('email_smtp_clear_password')
    await anyAdmin.from('email_smtp_settings').delete().eq('id', true)
    invalidateMailboxCache()
    expect((await anyAdmin.rpc('email_smtp_has_password')).data).toBe(false)
    expect((await anyAdmin.rpc('email_smtp_read_password')).data).toBeNull()
    expect(await loadDbSmtpConfig()).toBeNull()
  })
})
