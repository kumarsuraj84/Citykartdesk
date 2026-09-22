/**
 * Opening a ticket and seeing its status/conversation already IS reading whatever it
 * was notified about — the bell shouldn't keep saying "unread" for something the
 * viewer is looking straight at. Against the real database.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { markRequestNotificationsRead } from '@/lib/actions/notifications'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) { mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never) }

describe('markRequestNotificationsRead', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => { fx = await setupD03Fixtures() }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  it('marks only the viewer\'s own unread notifications for THIS request as read', async () => {
    const { data: n1 } = await admin.from('notifications').insert({
      user_id: fx.requesterA.id, actor_id: fx.agentA.id, type: 'comment_added',
      title: 'New reply', request_id: fx.requestA.id,
    }).select('id').single()
    // A different request — must NOT be touched.
    const { data: n2 } = await admin.from('notifications').insert({
      user_id: fx.requesterA.id, actor_id: fx.agentA.id, type: 'comment_added',
      title: 'New reply elsewhere', request_id: fx.requestB.id,
    }).select('id').single()
    // Someone else's notification for the SAME request — must NOT be touched.
    const { data: n3 } = await admin.from('notifications').insert({
      user_id: fx.agentA.id, actor_id: fx.requesterA.id, type: 'comment_added',
      title: 'New reply', request_id: fx.requestA.id,
    }).select('id').single()

    actAs(fx.requesterA)
    const res = await markRequestNotificationsRead(fx.requestA.id)
    expect(res.error).toBeUndefined()
    expect(res.updated).toBe(1)

    const read = async (id: string) => (await admin.from('notifications').select('read_at').eq('id', id).single()).data?.read_at

    expect(await read(n1!.id)).not.toBeNull()
    expect(await read(n2!.id)).toBeNull()
    expect(await read(n3!.id)).toBeNull()
  })

  it('a second call (nothing left unread) is a harmless no-op', async () => {
    actAs(fx.requesterA)
    const res = await markRequestNotificationsRead(fx.requestA.id)
    expect(res.error).toBeUndefined()
    expect(res.updated).toBe(0)
  })

  it('does not resurrect an already-archived notification', async () => {
    const { data: n } = await admin.from('notifications').insert({
      user_id: fx.requesterB.id, actor_id: fx.agentB.id, type: 'comment_added',
      title: 'Archived one', request_id: fx.requestB.id, archived_at: new Date().toISOString(), read_at: new Date().toISOString(),
    }).select('id').single()
    actAs(fx.requesterB)
    await markRequestNotificationsRead(fx.requestB.id)
    const { data } = await admin.from('notifications').select('archived_at').eq('id', n!.id).single()
    expect(data!.archived_at).not.toBeNull()
  })
})
