/**
 * B-25 / H-01 / F-02 / F-03: the facts a Business Rule's conditions are checked against come from ONE builder (lib/rules/run.ts#buildRuleEvaluationRequest), used by
 * the "created / updated" rules AND the scheduled rules (app/api/business-rules/run). The scheduled path used to build its own partial copy without the AC / vendor / store
 * facts, so a scheduled rule with such a condition never matched (is / is one of) or always matched (is not / is not one of).
 * No database: the admin client is a small fake that answers the few tables the builder reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/observability/alert', () => ({ alertOperator: vi.fn().mockResolvedValue({ sent: true }) }))

const { executeActionsMock, executeActionsWithResultMock } = vi.hoisted(() => ({
  executeActionsMock: vi.fn().mockResolvedValue(undefined),
  executeActionsWithResultMock: vi.fn().mockResolvedValue({ attempted: 1, succeeded: 1 }),
}))
vi.mock('@/lib/rules/actions', () => ({ executeActions: executeActionsMock, executeActionsWithResult: executeActionsWithResultMock }))

const TICKET = {
  id: 'req-1', request_no: 'CKSD-000001', title: 'AC not cooling', description: null, priority: 'medium', status: 'open',
  service_id: 'svc-1', team_id: 'team-1', project_id: null, requester_id: 'user-1', assigned_to: null, org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z', resolved_at: null, closed_at: null, source_metadata: null, form_data: {},
  waiting_since: null, response_due_at: null, resolution_due_at: null, category_id: 'cat-1', sub_category_id: null,
  reopen_count: 0, responded_at: null, paused_ms_total: 0,
  service: { template_id: null, sla_policy: null, form_sections: null, form_fields: null, template: null },
  requester: { role: 'user', department_id: null, location_id: null, designation_id: null, function_id: null, store_id: 'store-9' },
}

/** A query-builder stand-in: every chained call is recorded and returns the same proxy; awaiting it asks `resolver` what the table answers. */
function chain(resolver: (calls: Array<[string, unknown[]]>) => unknown) {
  const calls: Array<[string, unknown[]]> = []
  const proxy: unknown = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'then') { const p = Promise.resolve().then(() => resolver(calls)); return p.then.bind(p) }
      if (prop === 'catch') { const p = Promise.resolve().then(() => resolver(calls)); return p.catch.bind(p) }
      return (...args: unknown[]) => { calls.push([prop, args]); return proxy }
    },
  })
  return proxy
}

function fakeAdmin(rule: Record<string, unknown>) {
  return {
    from: (table: string) => chain((calls) => {
      const has = (m: string) => calls.some(([name]) => name === m)
      switch (table) {
        case 'business_rules': return { data: [rule], error: null }
        case 'requests': return has('maybeSingle') || has('single') ? { data: TICKET, error: null } : { data: [TICKET], error: null }
        case 'request_master_snapshots': return { data: { snapshot: [{ brand: 'Voltas', amc_vendor: 'Blue Star', region: 'West', state: 'Gujarat', cluster: 'C1' }] }, error: null }
        case 'service_categories': return { data: { program_id: null, auto_oem_kind: 'ac' }, error: null }
        case 'request_attachments': return { data: [], error: null }
        case 'business_rule_events': return has('insert') ? { error: null } : { data: [], error: null }
        default: return { data: [], error: null }
      }
    }),
    auth: { admin: { getUserById: vi.fn() } },
  }
}

const baseRule = { id: 'rule-1', name: 'AC rule', org_id: 'org-1', schedule_check: 'unassigned_minutes', schedule_threshold: 60, conditions_logic: 'AND', actions: [{ type: 'notify', params: { roles: [], notifyAssignee: false, notifyRequester: true, channels: ['in_app'] } }], execution_order: 1, trigger: ['created', 'updated', 'schedule'] }

function cronRequest() {
  return new NextRequest('http://localhost/api/x', { headers: { 'x-cron-secret': 'test-secret-0123456789-abcdef' } })
}

async function runBothPaths(conditions: unknown[]) {
  const rule = { ...baseRule, conditions }
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin(rule) }))
  vi.resetModules()
  executeActionsMock.mockClear()
  executeActionsWithResultMock.mockClear()
  const { runRulesForTrigger } = await import('@/lib/rules/run')
  await runRulesForTrigger('created', 'req-1')
  const { GET } = await import('@/app/api/business-rules/run/route')
  const res = await GET(cronRequest())
  expect(res.status).toBe(200)
  return { createdFired: executeActionsMock.mock.calls.length, scheduledFired: executeActionsWithResultMock.mock.calls.length }
}

beforeEach(() => { vi.stubEnv('CRON_SECRET', 'test-secret-0123456789-abcdef') })
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('@/lib/supabase/admin') })

describe('the created/updated path and the scheduled path evaluate the same facts', () => {
  it.each([
    ['ac_brand is Voltas', [{ field: 'ac_brand', operator: 'equals', value: 'Voltas' }], 1],
    ['ac_brand is not Voltas', [{ field: 'ac_brand', operator: 'not_equals', value: 'Voltas' }], 0],
    ['store_region is one of West / North', [{ field: 'store_region', operator: 'in', value: ['West', 'North'] }], 1],
    ['store_state is not one of Gujarat', [{ field: 'store_state', operator: 'not_in', value: ['Gujarat'] }], 0],
    ['vendor_line is ac (the category is an AC one)', [{ field: 'vendor_line', operator: 'equals', value: 'ac' }], 1],
    ['requester_store_id is store-9', [{ field: 'requester_store_id', operator: 'equals', value: 'store-9' }], 1],
    ['is_with_vendor is false', [{ field: 'is_with_vendor', operator: 'equals', value: 'false' }], 1],
  ])('%s', async (_name, conditions, expected) => {
    const { createdFired, scheduledFired } = await runBothPaths(conditions)
    expect(createdFired).toBe(expected)
    expect(scheduledFired).toBe(expected)
  })
})

describe('isSlaBreached / ageDays', () => {
  it('compares real instants: 10:00 at UTC-7 is 17:00 UTC, so at 12:00 UTC the ticket is NOT breached (as text it looked breached)', async () => {
    vi.resetModules()
    const { isSlaBreached } = await import('@/lib/rules/run')
    const now = Date.parse('2026-10-01T12:00:00Z')
    expect(isSlaBreached({ resolution_due_at: '2026-10-01T10:00:00-07:00', resolved_at: null, closed_at: null, status: 'in_progress' }, now)).toBe(false)
    expect(isSlaBreached({ resolution_due_at: '2026-10-01T10:00:00+05:30', resolved_at: null, closed_at: null, status: 'in_progress' }, now)).toBe(true)
    // resolved late / on time, compared as instants too
    expect(isSlaBreached({ resolution_due_at: '2026-10-01T10:00:00-07:00', resolved_at: '2026-10-01T16:59:00Z', closed_at: null, status: 'resolved' }, now)).toBe(false)
    expect(isSlaBreached({ resolution_due_at: '2026-10-01T10:00:00-07:00', resolved_at: '2026-10-01T17:01:00Z', closed_at: null, status: 'resolved' }, now)).toBe(true)
  })

  it('a ticket whose SLA clock is paused is not breached, however long ago its deadline was', async () => {
    vi.resetModules()
    const { isSlaBreached } = await import('@/lib/rules/run')
    const now = Date.parse('2026-10-01T12:00:00Z')
    for (const status of ['waiting_user', 'hold_purchase_ho', 'pending_approval']) {
      expect(isSlaBreached({ resolution_due_at: '2026-09-01T10:00:00Z', resolved_at: null, closed_at: null, status }, now), status).toBe(false)
    }
    expect(isSlaBreached({ resolution_due_at: '2026-09-01T10:00:00Z', resolved_at: null, closed_at: null, status: 'in_progress' }, now)).toBe(true)
  })

  it('age in days is whole days (1.5 days is 1, not 2)', async () => {
    vi.resetModules()
    const { ageDays } = await import('@/lib/rules/run')
    const now = Date.parse('2026-10-03T12:00:00Z')
    expect(ageDays({ created_at: '2026-10-02T00:00:00Z' }, now)).toBe(1)
    expect(ageDays({ created_at: '2026-10-01T12:00:00Z' }, now)).toBe(2)
    expect(ageDays({ created_at: '2026-10-03T11:00:00Z' }, now)).toBe(0)
  })
})

describe('G-11: a failed read is an error, not "no rules"', () => {
  it('the scheduled route answers 500 / ok:false when the rules cannot be read', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => chain(() => ({ data: null, error: { message: 'connection refused' } })) }) }))
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = await import('@/app/api/business-rules/run/route')
    const res = await GET(cronRequest())
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
  })

  it('runRulesForTrigger throws when the rules cannot be read (the caller then does not mark the rules as having run)', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({ from: (t: string) => chain(() => (t === 'requests' ? { data: TICKET, error: null } : { data: null, error: { message: 'boom' } })) }),
    }))
    vi.resetModules()
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await expect(runRulesForTrigger('created', 'req-1')).rejects.toThrow(/Could not read the Business Rules/)
  })
})
