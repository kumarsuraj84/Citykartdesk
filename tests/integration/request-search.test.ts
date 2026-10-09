/**
 * The Agent Requests search box: besides the title and ticket number it now finds tickets by the requester,
 * the technician, the service and the description, and the requester filter lists one person's tickets.
 * Against the real database, as a technician (so the normal visibility rules apply).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getRequests } from '@/lib/queries/requests'

// the tickets table's access rules cost about a millisecond per ticket, so a search can take several seconds on a busy local database
vi.setConfig({ testTimeout: 120_000 })

describe('Agent Requests search', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const marker = `zebra${Date.now()}`
  const wordInDescription = `quokka${Date.now()}`
  const names = { reqA: `Zq Requester A ${marker}`, reqB: `Zq Requester B ${marker}`, agentA: `Zq Agent A ${marker}`, service: `Zq Service ${marker}` }
  let t1: string // raised by requester A, handled by agent A, marker in the description
  let t2: string // raised by requester B, nobody handling it yet

  async function seed(requesterId: string, assignedTo: string | null, description: string) {
    const { data, error } = await admin.from('requests').insert({
      request_no: '', title: `search fixture ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, description,
      requester_id: requesterId, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: assignedTo, status: 'in_progress',
    }).select('id').single()
    if (error) throw error
    return data!.id as string
  }

  const search = (q: string, extra: { requesterId?: string } = {}) =>
    getRequests({ view: 'queue', userId: fx.agentA.id, status: undefined, q, pageSize: 100, ...extra }).then((r) => r.data.map((x) => x.id))

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    // earlier runs leave users with the same fixture names behind: give these ones names nobody else has
    for (const [u, name] of [[fx.requesterA, names.reqA], [fx.requesterB, names.reqB], [fx.agentA, names.agentA]] as const) await admin.from('profiles').update({ full_name: name }).eq('id', u.id)
    await admin.from('services').update({ name: names.service }).eq('id', fx.teamA.serviceId)
    vi.mocked(createClient).mockResolvedValue(clientForToken(fx.agentA.accessToken) as never)
    t1 = await seed(fx.requesterA.id, fx.agentA.id, `the ${wordInDescription} is broken`)
    t2 = await seed(fx.requesterB.id, null, 'plain description')
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  it('finds a ticket by its requester\'s name', async () => {
    const a = await search(names.reqA)
    expect(a).toContain(t1)
    expect(a).not.toContain(t2)
    const b = await search(names.reqB)
    expect(b).toContain(t2)
    expect(b).not.toContain(t1)
  })

  it('finds tickets by the technician handling them', async () => {
    const ids = await search(names.agentA)
    expect(ids).toContain(t1)
    expect(ids).not.toContain(t2)
  })

  it('finds tickets by the service name and by the description', async () => {
    const byService = await search(names.service)
    expect(byService).toEqual(expect.arrayContaining([t1, t2]))
    const byDescription = await search(wordInDescription)
    expect(byDescription).toEqual([t1])
  })

  it('still finds by ticket number and title, and a search with no match returns nothing', async () => {
    const { data } = await admin.from('requests').select('request_no, title').eq('id', t1).single()
    expect(await search(data!.request_no)).toContain(t1)
    expect(await search(data!.title)).toContain(t1)
    expect(await search(`nothing-matches-${marker}-xyz`)).toEqual([])
  })

  it('the requester filter lists only that person\'s tickets and combines with the search', async () => {
    expect(await search('', { requesterId: fx.requesterB.id })).toEqual([t2])
    expect(await search('plain', { requesterId: fx.requesterB.id })).toEqual([t2])
    expect(await search('plain', { requesterId: fx.requesterA.id })).toEqual([])
  })
})
