/**
 * The store card (stores table) is the main store master: a Business Rule sees the requester's store region, state, cluster, city, priority list, festival and months since
 * opening for a ticket of ANY service (an IT ticket, an RO ticket, a ticket with no Vendor Program at all). The AC row / program row saved with the ticket only fills what the
 * card leaves empty, so the rules made for the AC sheet's region keep matching. No database: a small fake answers the tables the fact builder reads.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

function chain(resolver: (calls: Array<[string, unknown[]]>) => unknown) {
  const calls: Array<[string, unknown[]]> = []
  const proxy: unknown = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'then') { const p = Promise.resolve().then(() => resolver(calls)); return p.then.bind(p) }
      return (...args: unknown[]) => { calls.push([prop, args]); return proxy }
    },
  })
  return proxy
}

type World = { store?: Record<string, unknown> | null; storeError?: string; acSnapshot?: Record<string, string> | null; programRow?: { vendor?: string; extra?: Record<string, string> } | null }

function fakeAdmin(w: World) {
  return {
    from: (table: string) => chain(() => {
      switch (table) {
        case 'stores': return w.storeError ? { data: null, error: { message: w.storeError } } : { data: w.store ?? null, error: null }
        case 'request_master_snapshots': return { data: w.acSnapshot ? { snapshot: [w.acSnapshot] } : null, error: null }
        case 'request_program_snapshots': return { data: w.programRow ? { snapshot: [w.programRow] } : null, error: null }
        case 'service_categories': return { data: { program_id: null, auto_oem_kind: null }, error: null }
        case 'request_attachments': return { data: [], error: null }
        default: return { data: [], error: null }
      }
    }),
    auth: { admin: { getUserById: vi.fn() } },
  }
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

function ticket(storeId: string | null) {
  return {
    id: 'req-1', request_no: 'CKSD-000001', title: 'Printer', description: null, priority: 'medium', status: 'open', service_id: 'svc-it', team_id: 'team-1', project_id: null,
    requester_id: 'u1', assigned_to: null, org_id: 'org-1', created_at: '2026-10-30T00:00:00Z', resolved_at: null, closed_at: null, source_metadata: null, form_data: {},
    waiting_since: null, response_due_at: null, resolution_due_at: null, category_id: 'cat-it', sub_category_id: null, reopen_count: 0, responded_at: null, paused_ms_total: 0,
    service: { template_id: null, sla_policy: null, form_sections: null, form_fields: null, template: null },
    requester: { role: 'user', department_id: null, location_id: null, designation_id: null, function_id: null, store_id: storeId },
  }
}

async function facts(w: World, storeId: string | null = 'store-1') {
  vi.resetModules()
  const { buildRuleEvaluationRequest } = await import('@/lib/rules/run')
  return buildRuleEvaluationRequest(fakeAdmin(w) as never, ticket(storeId) as never)
}

const CARD = { code: 'JHG', address: 'Hotel Meghdoot', pincode: '768201', city: 'Jharsuguda', state: 'Odisha', region: 'East', cluster: 'OD-1', priority_list: 'P2', festival: 'Durga Puja', open_date: daysAgo(100) }

describe('a ticket with no AC and no Vendor Program (an IT ticket) still sees its store details', () => {
  it('reads region, state, cluster, city, priority list, festival and months since opening from the store card', async () => {
    const f = await facts({ store: CARD })
    expect(f).toMatchObject({ store_region: 'East', store_state: 'Odisha', store_cluster: 'OD-1', store_city: 'Jharsuguda', store_priority: 'P2', store_festival: 'Durga Puja' })
    expect(Number(f.store_open_months)).toBeGreaterThanOrEqual(3)
    expect(Number(f.store_open_months)).toBeLessThanOrEqual(4)
  })
  it('a store without an opening date has an empty month count (is empty matches, "less than 9" does not)', async () => {
    const { matchesConditions } = await import('@/lib/rules/evaluate')
    const f = await facts({ store: { ...CARD, open_date: null } })
    expect(f.store_open_months).toBe('')
    expect(matchesConditions(f, [{ field: 'store_open_months', operator: 'lt', value: '9' }], 'AND')).toBe(false)
    expect(matchesConditions(f, [{ field: 'store_open_months', operator: 'is_empty', value: '' }], 'AND')).toBe(true)
  })
  it('a rule on months since opening matches a new store and not an old one', async () => {
    const { matchesConditions } = await import('@/lib/rules/evaluate')
    const fresh = await facts({ store: { ...CARD, open_date: daysAgo(60) } })
    const old = await facts({ store: { ...CARD, open_date: '2015-01-01' } })
    const underNine = [{ field: 'store_open_months' as const, operator: 'lt' as const, value: '9' }]
    expect(matchesConditions(fresh, underNine, 'AND')).toBe(true)
    expect(matchesConditions(old, underNine, 'AND')).toBe(false)
  })
  it('conditions on region, city and priority list match from the card', async () => {
    const { matchesConditions } = await import('@/lib/rules/evaluate')
    const f = await facts({ store: CARD })
    expect(matchesConditions(f, [{ field: 'store_region', operator: 'in', value: ['East', 'West'] }, { field: 'store_city', operator: 'equals', value: 'Jharsuguda' }, { field: 'store_priority', operator: 'equals', value: 'P2' }], 'AND')).toBe(true)
    expect(matchesConditions(f, [{ field: 'store_region', operator: 'equals', value: 'North' }], 'AND')).toBe(false)
  })
})

describe('the AC row and the program row only fill what the store card leaves empty', () => {
  it('the card wins over the AC row', async () => {
    const f = await facts({ store: CARD, acSnapshot: { amc_vendor: 'Voltas', brand: 'Voltas', region: 'West', state: 'Gujarat', cluster: 'GJ-9' } })
    expect(f).toMatchObject({ store_region: 'East', store_state: 'Odisha', store_cluster: 'OD-1', ac_amc_vendor: 'Voltas', ac_brand: 'Voltas' })
  })
  it('an empty card detail is filled from the AC row (the rules made for the AC sheet keep matching)', async () => {
    const f = await facts({ store: { ...CARD, region: null, cluster: '' }, acSnapshot: { region: 'West', state: 'Gujarat', cluster: 'GJ-9' } })
    expect(f).toMatchObject({ store_region: 'West', store_cluster: 'GJ-9', store_state: 'Odisha' })
  })
  it('a ticket of a program with no store card detail uses the program row headings', async () => {
    const f = await facts({ store: { ...CARD, region: null }, programRow: { vendor: 'Aqua Care', extra: { Region: 'South' } } })
    expect(f.store_region).toBe('South')
  })
  it('with no store card at all the old AC row still answers (and the new details are empty)', async () => {
    const f = await facts({ store: null, acSnapshot: { region: 'West', state: 'Gujarat', cluster: 'GJ-9' } })
    expect(f).toMatchObject({ store_region: 'West', store_state: 'Gujarat', store_cluster: 'GJ-9', store_city: '', store_priority: '', store_festival: '', store_open_months: '' })
  })
})

describe('no store, and an unreadable store', () => {
  it('a requester with no store has empty store details and nothing fails', async () => {
    const f = await facts({}, null)
    expect(f).toMatchObject({ store_region: '', store_city: '', store_open_months: '', requester_store_id: '' })
  })
  it('an unreadable store card is an error, not "this store has no region" (an "is not" rule would match wrongly)', async () => {
    await expect(facts({ storeError: 'connection refused' })).rejects.toThrow(/Could not read the store/)
  })
})
