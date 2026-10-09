/**
 * The small check the pop-ups ask every few seconds, against the real database: only the signed-in person's own unread,
 * not archived notifications created after "since" (the newest ten, oldest first), plus their unread count.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
const state = vi.hoisted(() => ({ profile: null as unknown }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn(async () => state.profile) }))

import { createClient } from '@/lib/supabase/server'
import { GET } from '@/app/api/notifications/new/route'

vi.setConfig({ testTimeout: 60_000 })

describe('GET /api/notifications/new', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const t0 = new Date(Date.now() - 60 * 60_000).toISOString()

  async function as(user: TestUser | null) {
    if (!user) { state.profile = null; return }
    const { data } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('id', user.id).single()
    state.profile = data
    vi.mocked(createClient).mockResolvedValue(clientForToken(user.accessToken) as never)
  }
  const call = async (since?: string) => {
    const res = await GET(new Request(`http://app.test/api/notifications/new${since ? `?since=${encodeURIComponent(since)}` : ''}`))
    return { status: res.status, body: res.status === 200 ? await res.json() : null }
  }
  const add = async (user: TestUser, title: string, extra: Record<string, unknown> = {}, minutesAgo = 0) => {
    const { data, error } = await admin.from('notifications').insert({
      user_id: user.id, actor_id: fx.agentA.id, type: 'comment_added', title, body: 'b', created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...extra,
    }).select('id').single()
    if (error) throw error
    return data!.id as string
  }

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    await add(fx.requesterA, 'old unread', {}, 30)
    await add(fx.requesterA, 'new unread 1', {}, 3)
    await add(fx.requesterA, 'new unread 2', {}, 1)
    await add(fx.requesterA, 'already read', { read_at: new Date().toISOString() }, 2)
    await add(fx.requesterA, 'archived', { archived_at: new Date().toISOString() }, 2)
    await add(fx.requesterB, 'someone else\'s', {}, 1)
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  it('needs a signed-in person', async () => {
    await as(null)
    expect((await call(t0)).status).toBe(401)
  })

  it('returns only my own unread, not-archived notifications after "since", oldest first, with who did it', async () => {
    await as(fx.requesterA)
    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const { status, body } = await call(since)
    expect(status).toBe(200)
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(['new unread 1', 'new unread 2'])
    expect(body.items[0].actor_name).toBe('D03 Agent A')
    expect(JSON.stringify(body)).not.toContain('someone else')
    expect(typeof body.now).toBe('string')
  })

  it('the unread count covers all my unread (not just the new ones) and is private to me', async () => {
    await as(fx.requesterA)
    expect((await call(t0)).body.unread).toBe(3) // old unread + 2 new unread; read and archived are not counted
    await as(fx.requesterB)
    const b = (await call(t0)).body
    expect(b.unread).toBe(1)
    expect(b.items.map((i: { title: string }) => i.title)).toEqual(['someone else\'s'])
  })

  it('without "since" (a hidden tab) it only gives the count, and a bad "since" is ignored', async () => {
    await as(fx.requesterA)
    const hidden = (await call()).body
    expect(hidden.items).toEqual([])
    expect(hidden.unread).toBe(3)
    const bad = await call('not-a-date')
    expect(bad.status).toBe(200)
    expect(bad.body.items).toEqual([])
  })

  it('hands back the newest ten when many are waiting', async () => {
    await as(fx.requesterB)
    for (let i = 0; i < 12; i++) await add(fx.requesterB, `burst ${i}`, {}, 0.5)
    const { body } = await call(t0)
    expect(body.items).toHaveLength(10)
    expect(body.items.some((i: { title: string }) => i.title === 'burst 11')).toBe(true)
  })
})
