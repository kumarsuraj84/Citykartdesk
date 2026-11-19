import { describe, it, expect, vi, beforeEach } from 'vitest'

// The ticket search no longer reads the text of EVERY message by default (with 64,000+ messages from the Zoho move one search kept the database busy for minutes and
// slowed the whole system). Looking inside messages is an option with a time limit; if it runs out, the ticket search still answers and says so.
vi.mock('server-only', () => ({}))
type Call = { table: string; method: string; args: unknown[] }
let calls: Call[] = []
let messageSearchFails = false
let sawAbortSignal = false

function builder(table: string) {
  const self: Record<string, unknown> = {}
  const result = () => {
    if (table === 'request_comments') return messageSearchFails ? { data: null, error: { message: 'aborted' }, count: null } : { data: [{ request_id: 'req-from-message' }], error: null, count: null }
    return { data: [], error: null, count: 0 }
  }
  const proxy: unknown = new Proxy(self, {
    get(_t, prop: string) {
      if (prop === 'then') { const p = Promise.resolve(result()); return p.then.bind(p) }
      return (...args: unknown[]) => {
        calls.push({ table, method: prop, args })
        if (prop === 'abortSignal') sawAbortSignal = args[0] instanceof AbortSignal
        return proxy
      }
    },
  })
  return proxy
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => null }))

import { getRequests, MESSAGE_SEARCH_LIMIT_MS } from '@/lib/queries/requests'

beforeEach(() => { calls = []; messageSearchFails = false; sawAbortSignal = false })
const asked = (table: string) => calls.some((c) => c.table === table)

describe('ticket search and the text of messages', () => {
  it('a normal search never reads the message table', async () => {
    const r = await getRequests({ view: 'mine', userId: 'u1', q: 'printer' })
    expect(asked('request_comments')).toBe(false)
    expect(asked('profiles')).toBe(true)                      // people, stores, services and categories are still searched (small tables)
    expect(r.searchNote).toBeUndefined()
  })

  it('the ticket number, title and description are still part of the search', async () => {
    await getRequests({ view: 'mine', userId: 'u1', q: 'CKSD-001' })
    const or = calls.find((c) => c.table === 'requests' && c.method === 'or')
    expect(String(or?.args[0])).toContain('title.ilike.%CKSD-001%')
    expect(String(or?.args[0])).toContain('request_no.ilike.%CKSD-001%')
    expect(String(or?.args[0])).toContain('description.ilike.%CKSD-001%')
  })

  it('"also search inside messages" reads the message table, with a time limit, and adds the tickets found', async () => {
    await getRequests({ view: 'mine', userId: 'u1', q: 'printer', searchMessages: true })
    expect(asked('request_comments')).toBe(true)
    expect(sawAbortSignal).toBe(true)                         // a time limit is attached (MESSAGE_SEARCH_LIMIT_MS)
    expect(MESSAGE_SEARCH_LIMIT_MS).toBeLessThanOrEqual(10_000)
    const or = calls.find((c) => c.table === 'requests' && c.method === 'or')
    expect(String(or?.args[0])).toContain('id.in.(req-from-message)')
  })

  it('when the message search runs out of time the ticket search still answers, and the person is told', async () => {
    messageSearchFails = true
    const r = await getRequests({ view: 'mine', userId: 'u1', q: 'printer', searchMessages: true })
    expect(r.searchNote).toMatch(/took too long/)
    const or = calls.find((c) => c.table === 'requests' && c.method === 'or')
    expect(String(or?.args[0])).not.toContain('id.in.(req-from-message)')
  })

  it('no search text means no message lookup at all, even when asked', async () => {
    await getRequests({ view: 'mine', userId: 'u1', searchMessages: true })
    expect(asked('request_comments')).toBe(false)
  })
})
