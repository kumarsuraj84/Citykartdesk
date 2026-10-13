// Reliability: a database statement that runs past its time limit. The signed-in role's limit is 8 s in this stack; here it is cut to 1 millisecond so
// that every statement times out, to show what the application does (a clear error, no crash, nothing half-changed) and that it recovers when the limit
// is back. The original setting is read first and ALWAYS restored (afterAll), then the API layer is told to reload it.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'
import { API, ANON } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)
const actAs = (u: TestUser) => mockedCreateClient.mockResolvedValue(clientForToken(u.accessToken) as never)
const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const reloadApi = async () => { psql("notify pgrst, 'reload schema'"); psql("notify pgrst, 'reload config'"); await new Promise((r) => setTimeout(r, 2500)) }

describe('statement timeout on the signed-in role', () => {
  let fx: D03Fixtures
  const db = getAdmin()
  let original = ''
  beforeAll(async () => {
    fx = await setupD03Fixtures()
    original = psql("select setconfig::text from pg_db_role_setting where setrole = 'authenticated'::regrole")
    expect(original).toContain('statement_timeout=8s') // the setting this test restores
  }, 120_000)
  afterAll(async () => {
    psql("alter role authenticated set statement_timeout = '8s'")
    await reloadApi()
    await fx?.cleanup()
  }, 120_000)

  it('every statement times out: the action fails cleanly, nothing changes; after the limit is restored it works', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    psql("alter role authenticated set statement_timeout = '1ms'")
    await reloadApi()
    let direct: { status: number; body: string } | null = null
    let outcome: { error?: string } = {}
    try {
      // straight to the API as the signed-in user
      const r = await fetch(`${API}/rest/v1/requests?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${fx.agentA.accessToken}` } })
      direct = { status: r.status, body: await r.text() }
      // and through the application action
      actAs(fx.agentA)
      outcome = await updateRequestStatus(t.id, 'waiting_user', 'Please send a photo.').then((r2) => ({ error: r2.error }), (e: unknown) => ({ error: `thrown: ${String(e)}` }))
    } finally {
      psql("alter role authenticated set statement_timeout = '8s'")
      await reloadApi()
    }
    // the API answers with an error (statement timeout), not data and not a hang
    expect(direct!.status).toBeGreaterThanOrEqual(400)
    expect(direct!.body).toMatch(/57014|statement timeout|canceling statement/i)
    // the action reports an error (or the app's error screen takes over) and never claims success
    expect(outcome.error).toBeTruthy()
    expect((await db.from('requests').select('status').eq('id', t.id).single()).data?.status).toBe('in_progress')
    // recovered
    actAs(fx.agentA)
    expect((await updateRequestStatus(t.id, 'waiting_user', 'Please send a photo.')).error).toBeUndefined()
    expect((await db.from('requests').select('status').eq('id', t.id).single()).data?.status).toBe('waiting_user')
  }, 180_000)
})
