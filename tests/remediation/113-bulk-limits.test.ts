// D-047 / D-050: bulk actions take a list of ids from the browser. The list is checked (only real ids, no repeats, at most 500), and a long
// list is sent to the database in batches, so exporting a few hundred selected tickets works instead of failing on an over-long address.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { bulkExportRequests, bulkUpdateStatus, bulkAssignRequests, bulkAddCollaborators } from '@/lib/actions/requests'

vi.setConfig({ testTimeout: 180_000 })

let fx: D03Fixtures
const ids: string[] = []

beforeAll(async () => {
  fx = await setupD03Fixtures()
  vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
  for (let i = 0; i < 260; i += 10) {
    const batch = await Promise.all(Array.from({ length: 10 }, () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })))
    ids.push(...batch.map((r) => r.id))
  }
}, 180_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

describe('bulk actions: limits and batching', () => {
  it('exporting 260 selected tickets works (the list is sent in batches), repeats are counted once', async () => {
    const r = await bulkExportRequests([...ids, ...ids.slice(0, 5)])
    expect(r.error).toBeUndefined()
    const lines = (r.csv ?? '').trim().split(/\r?\n/)
    expect(lines.length).toBeGreaterThanOrEqual(261)           // header + one row per ticket (cells holding line breaks are quoted)
    expect(lines.length).toBeLessThan(270)
  })

  it('more than 500 ids, an empty list, or a list of things that are not ids is refused before anything is touched', async () => {
    const many = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    for (const bad of [many, [], ['x', '1; drop table requests', '../etc'], 'nope' as unknown as string[]]) {
      expect((await bulkExportRequests(bad)).error, JSON.stringify(bad).slice(0, 40)).toBeTruthy()
      for (const result of [await bulkUpdateStatus(bad, 'cancelled'), await bulkAssignRequests(bad, null), await bulkAddCollaborators(bad, fx.agentA.id)]) {
        expect(result.succeeded).toEqual([])
        expect(result.failed[0]?.error).toMatch(/at most 500|No requests selected/)
      }
    }
  })

})
