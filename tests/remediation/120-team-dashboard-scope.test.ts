// A normal user who has people reporting to them gets the normal Dashboard for those people's tickets (raised by or assigned to them). This checks, on the
// audit database's synthetic tickets and through the real functions, that the Dashboard's numbers and the pop-up's tickets are exactly those tickets, and that
// the figures of a team of nobody are zero.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'
import { svc } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getAnalytics } from '@/lib/queries/analytics'
import { loadExecutiveRows } from '@/lib/queries/executive-dashboard'

vi.setConfig({ testTimeout: 180_000 })

let fx: D03Fixtures
let orgId = ''
let reportIds: string[] = []

/** how many tickets a query returns (the database answers 1000 at a time) */
async function count(filter: string): Promise<number> {
  let total = 0
  for (let offset = 0; ; offset += 1000) {
    const r = await svc<{ id: string }[]>('GET', `/requests?select=id&org_id=eq.${orgId}${filter}&order=id.asc&limit=1000&offset=${offset}`)
    if (!Array.isArray(r.json)) throw new Error(`query failed: ${r.text.slice(0, 200)}`)
    total += r.json.length
    if (r.json.length < 1000) return total
  }
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
  orgId = (await getCurrentProfile())!.org_id!
  const r = await svc<{ requester_id: string; assigned_to: string | null }[]>('GET', `/requests?select=requester_id,assigned_to&org_id=eq.${orgId}&limit=400`)
  const seen = new Map<string, number>()
  for (const t of r.json) for (const id of [t.requester_id, t.assigned_to]) if (id) seen.set(id, (seen.get(id) ?? 0) + 1)
  reportIds = [...seen].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
}, 240_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

describe("the Dashboard of a person with a team counts exactly the team's tickets", () => {
  it('there are people with tickets to test with', () => { expect(reportIds.length).toBeGreaterThan(0) })

  it('created in the period, open now and the rolling inflow all equal what the database holds for those people', async () => {
    const scope = { kind: 'reports' as const, userId: 'nobody', reportIds }
    const a = await getAnalytics(orgId, '30d', scope)
    const team = `&or=(requester_id.in.(${reportIds.join(',')}),assigned_to.in.(${reportIds.join(',')}))`
    const start = new Date(a.periodWindow.start).toISOString()
    const end = new Date(a.periodWindow.end).toISOString()
    expect(a.totalCreated).toBe(await count(`${team}&created_at=gte.${start}&created_at=lte.${end}`))
    expect(a.totalOpenNow).toBe(await count(`${team}&status=not.in.(resolved,closed,cancelled)`))
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0); midnight.setDate(midnight.getDate() - 30)
    expect(a.requestFlow.inflow.last30d).toBe(await count(`${team}&created_at=gte.${midnight.toISOString()}`))
    expect(a.totalCreated).toBeGreaterThan(0)
  })

  it("the pop-up's tickets (the executive rows) are the same tickets", async () => {
    const rows = await loadExecutiveRows(orgId, 'requester', { kind: 'reports', userId: 'nobody', reportIds })
    const team = `&or=(requester_id.in.(${reportIds.join(',')}),assigned_to.in.(${reportIds.join(',')}))`
    expect(rows.tickets.length).toBe(await count(team))
  })

  it('a person whose team is nobody gets nothing', async () => {
    const a = await getAnalytics(orgId, '30d', { kind: 'reports', userId: 'nobody', reportIds: [] })
    expect(a.totalCreated).toBe(0)
    expect(a.totalOpenNow).toBe(0)
    expect(a.requestFlow.inflow.last30d).toBe(0)
  })
})
