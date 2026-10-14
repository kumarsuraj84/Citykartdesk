// Who made a change the server made with its own (row-security-bypassing) client? The admin client names the signed-in person in x-actor-id;
// the audit trigger believes that header ONLY for the service role. A signed-in user cannot use it to blame someone else.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { svc, login, http, API, ANON, ORG_A, type Session } from './helpers'
import { signVerifiedUser } from '@/lib/auth/verified-user'

// the System Log recorder is a no-op under Vitest unless a test opts in; these tests read what it wrote
process.env.SYSTEM_LOG_IN_TESTS = '1'

vi.mock('server-only', () => ({}))
const hdrs = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => hdrs.current }))

import { createAdminClient } from '@/lib/supabase/admin'

let admin: Session, staff: Session, other: Session
let saved: { job_title: string | null; full_name: string }
const tag = `act${Date.now()}`
const lastRows = async (id: string) => (await svc<{ actor_id: string | null; actor_role: string | null; request_id: string | null; after_data: Record<string, string> }[]>('GET', `/system_log?entity_type=eq.profiles&entity_id=eq.${id}&order=id.desc&limit=3`)).json

beforeAll(async () => {
  ;[admin, staff, other] = await Promise.all(['admin1', 'staff1', 'staff2'].map((n) => login(`${n}@audit.test`)))
  saved = (await svc<{ job_title: string | null; full_name: string }[]>('GET', `/profiles?id=eq.${staff.id}&select=job_title,full_name`)).json[0]
})
afterAll(async () => { await svc('PATCH', `/profiles?id=eq.${staff.id}`, { job_title: saved.job_title, full_name: saved.full_name }) })

describe('attribution of server-side changes', () => {
  it('a change made by the server inside a request is attributed to the signed-in person and carries the request id', async () => {
    hdrs.current = new Headers({ 'x-verified-user-id': admin.id, 'x-verified-user-sig': signVerifiedUser(admin.id)!, 'x-request-id': `req-${tag}` })
    const db = createAdminClient() as unknown as { from: (t: string) => { update: (v: object) => { eq: (c: string, v: string) => Promise<unknown> } } }
    await db.from('profiles').update({ job_title: `${tag} one` }).eq('id', staff.id)
    const [row] = await lastRows(staff.id)
    expect(row).toMatchObject({ actor_id: admin.id, actor_role: 'service_role', request_id: `req-${tag}` })
    expect(row.after_data).toEqual({ job_title: `${tag} one` })
  })
  it('outside a request (a script or a scheduled job) there is simply no actor', async () => {
    hdrs.current = new Headers()
    const db = createAdminClient() as unknown as { from: (t: string) => { update: (v: object) => { eq: (c: string, v: string) => Promise<unknown> } } }
    await db.from('profiles').update({ job_title: `${tag} two` }).eq('id', staff.id)
    const [row] = await lastRows(staff.id)
    expect(row).toMatchObject({ actor_id: null, actor_role: 'service_role', request_id: null })
  })
  it('a header forged by a client is never trusted: the browser cannot send the proxy-signed id, and a signed-in user\'s own token ignores x-actor-id', async () => {
    // a user changing their own profile through the API while claiming to be somebody else
    const r = await fetch(`${API}/rest/v1/profiles?id=eq.${staff.id}`, {
      method: 'PATCH',
      headers: { apikey: ANON, Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/json', 'x-actor-id': other.id, 'x-request-id': 'forged-request' },
      body: JSON.stringify({ full_name: `${tag} renamed` }),
    })
    expect(r.status).toBeLessThan(400)
    const rows = await lastRows(staff.id)
    const mine = rows.find((x) => x.after_data?.full_name === `${tag} renamed`)!
    expect(mine).toBeTruthy()
    expect(mine.actor_id).toBe(staff.id)          // the real caller, never the forged one
    expect(mine.request_id).toBeNull()
    expect(rows.some((x) => x.actor_id === other.id)).toBe(false)
  })
  it('the service role with an invalid actor id is recorded without an actor', async () => {
    await http('PATCH', `/rest/v1/profiles?id=eq.${staff.id}`, { key: process.env.SUPABASE_SERVICE_ROLE_KEY!, token: process.env.SUPABASE_SERVICE_ROLE_KEY!, body: { job_title: `${tag} three` }, headers: { 'x-actor-id': 'not-a-uuid; drop table' } })
    const [row] = await lastRows(staff.id)
    expect(row.actor_id).toBeNull()
    expect(ORG_A).toBeTruthy()
  })
})
