// D-048: inviting a user is several steps (account, profile, mobile number, groups). If a step after the account exists fails, the half-made
// account is removed again, so the administrator can fix the problem and simply try again with the same address.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'
import { svc, http, SERVICE } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { inviteUser } from '@/lib/actions/admin/users'

vi.setConfig({ testTimeout: 90_000 })

const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const tag = `inv${Date.now()}`
let fx: D03Fixtures

const authUserByEmail = async (email: string) => {
  const r = await http<{ users?: { id: string; email: string }[] }>('GET', '/auth/v1/admin/users?per_page=1000', { key: SERVICE, token: SERVICE })
  return (r.json.users ?? []).find((u) => u.email.toLowerCase() === email.toLowerCase())
}
// profiles carry no e-mail column: they are found by the (unique) name used in each test
const profileCount = async (name: string) => { const r = await svc<unknown[]>('GET', `/profiles?full_name=eq.${encodeURIComponent(name)}&select=id`); return Array.isArray(r.json) ? r.json.length : -1 }

beforeAll(async () => { fx = await setupD03Fixtures(); vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never) }, 120_000)
afterAll(async () => {
  psql('alter table profiles drop constraint if exists tmp_invite_fail')
  psql('alter table profile_mobile_numbers drop constraint if exists tmp_invite_fail')
  for (const e of [`${tag}-ok@audit.test`, `${tag}-a@audit.test`, `${tag}-b@audit.test`]) { const u = await authUserByEmail(e); if (u) await http('DELETE', `/auth/v1/admin/users/${u.id}`, { key: SERVICE, token: SERVICE }) }
  await fx?.cleanup()
}, 120_000)

describe('invite user rollback (D-048)', () => {
  it('a normal invite still works', async () => {
    const email = `${tag}-ok@audit.test`
    const r = await inviteUser({ email, full_name: 'Invite Ok', role: 'user', job_title: 'Clerk' })
    expect(r.error).toBeUndefined()
    expect(await authUserByEmail(email)).toBeTruthy()
    expect(await profileCount('Invite Ok')).toBe(1)
  })

  it('when the profile step fails, the new account is removed and the same address can be invited again', async () => {
    const email = `${tag}-a@audit.test`
    psql("alter table profiles add constraint tmp_invite_fail check (job_title is distinct from 'boom-title') not valid")
    try {
      const r = await inviteUser({ email, full_name: 'Invite A', role: 'user', job_title: 'boom-title' })
      expect(r.error).toBeTruthy()
    } finally { psql('alter table profiles drop constraint if exists tmp_invite_fail') }
    expect(await authUserByEmail(email)).toBeUndefined()
    expect(await profileCount('Invite A')).toBe(0)
    expect((await inviteUser({ email, full_name: 'Invite A', role: 'user', job_title: 'Clerk' })).error).toBeUndefined()
  })

  it('when attaching the mobile number fails, the new account is removed again', async () => {
    const email = `${tag}-b@audit.test`
    psql('alter table profile_mobile_numbers add constraint tmp_invite_fail check (false) not valid')
    try {
      const r = await inviteUser({ email, full_name: 'Invite B', role: 'user', mobile_number: '9876500011' })
      expect(r.error).toBeTruthy()
    } finally { psql('alter table profile_mobile_numbers drop constraint if exists tmp_invite_fail') }
    expect(await authUserByEmail(email)).toBeUndefined()
    expect(await profileCount('Invite B')).toBe(0)
  })
})
