/**
 * DESK-OBS-001 — cron health semantics.
 *
 * Both app/api/alerts/run and app/api/business-rules/run already isolated
 * per-rule failures (one rule throwing never stopped the loop), but the
 * response was always a bare `{ ok: true }` regardless of how many rules
 * actually failed — a total outage looked identical to a quiet night with
 * nothing due. This exercises the route handlers directly (mocking the
 * Supabase admin client, not a real DB) to verify the new structured
 * envelope: `processed/succeeded/failed/failures[]`, and a non-2xx status
 * only when every processed rule failed (never for a partial failure, which
 * stays 200 with the failures visible in the body).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const alertOperatorMock = vi.fn().mockResolvedValue({ sent: true })
vi.mock('@/lib/observability/alert', () => ({ alertOperator: alertOperatorMock }))

/** A minimal thenable Supabase query-builder stand-in. Any chained method
 *  call (eq/not/gte/lte/in/select/order/limit/contains/maybeSingle/insert…)
 *  just records the call and returns the same proxy for further chaining;
 *  awaiting it resolves via `resolver(calls)`, which can inspect which
 *  filters were applied (e.g. `.eq('org_id', X)`) to decide what to return
 *  — or throw, to simulate a failed query for one specific rule. */
function makeChain(resolver: (calls: Array<[string, unknown[]]>) => unknown) {
  const calls: Array<[string, unknown[]]> = []
  const proxy: unknown = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        const p = Promise.resolve().then(() => resolver(calls))
        return p.then.bind(p)
      }
      if (prop === 'catch') {
        const p = Promise.resolve().then(() => resolver(calls))
        return p.catch.bind(p)
      }
      return (...args: unknown[]) => { calls.push([prop, args]); return proxy }
    },
  })
  return proxy
}

function orgIdFilter(calls: Array<[string, unknown[]]>): string | undefined {
  const call = calls.find(([m, a]) => m === 'eq' && a[0] === 'org_id')
  return call?.[1]?.[1] as string | undefined
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret')
  alertOperatorMock.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.doUnmock('@/lib/supabase/admin')
})

function cronRequest() {
  return new NextRequest('http://localhost/api/x', { headers: { 'x-cron-secret': 'test-secret' } })
}

describe('app/api/business-rules/run — cron health envelope', () => {
  it('no active rules: processed=0, succeeded=0, failed=0, status 200', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({ from: (table: string) => makeChain(() => (table === 'business_rules' ? { data: [] } : { data: [] })) }),
    }))
    const { GET } = await import('@/app/api/business-rules/run/route')
    const res = await GET(cronRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, processed: 0, succeeded: 0, failed: 0, failures: [] })
  })

  it('a mix of one failing and one succeeding rule: status stays 200, failure is reported, no operator alert (not a total failure)', async () => {
    const rules = [
      { id: 'rule-fail', name: 'Fails', org_id: 'org-fail', schedule_check: 'sla_pct_elapsed', schedule_threshold: 80, conditions: [], conditions_logic: 'all', actions: [] },
      { id: 'rule-ok', name: 'Ok', org_id: 'org-ok', schedule_check: 'unassigned_minutes', schedule_threshold: 120, conditions: [], conditions_logic: 'all', actions: [] },
    ]
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        from: (table: string) => makeChain((calls) => {
          if (table === 'business_rules') return { data: rules }
          if (table === 'requests') {
            if (orgIdFilter(calls) === 'org-fail') throw new Error('simulated DB failure')
            return { data: [] }
          }
          return { data: [] }
        }),
      }),
    }))
    const { GET } = await import('@/app/api/business-rules/run/route')
    const res = await GET(cronRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.processed).toBe(2)
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(1)
    expect(body.failures).toEqual([{ ruleId: 'rule-fail', scheduleCheck: 'sla_pct_elapsed', code: 'business_rule_sla_pct_elapsed_failed' }])
    expect(body.ok).toBe(true) // partial failure is not a total outage
    expect(alertOperatorMock).not.toHaveBeenCalled()
  })

  it('every processed rule fails: status 502, ok=false, operator alerted once', async () => {
    const rules = [
      { id: 'rule-1', name: 'A', org_id: 'org-fail', schedule_check: 'sla_pct_elapsed', schedule_threshold: 80, conditions: [], conditions_logic: 'all', actions: [] },
      { id: 'rule-2', name: 'B', org_id: 'org-fail', schedule_check: 'unassigned_minutes', schedule_threshold: 120, conditions: [], conditions_logic: 'all', actions: [] },
    ]
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        from: (table: string) => makeChain((calls) => {
          if (table === 'business_rules') return { data: rules }
          if (table === 'requests') {
            if (orgIdFilter(calls) === 'org-fail') throw new Error('simulated DB failure')
            return { data: [] }
          }
          return { data: [] }
        }),
      }),
    }))
    const { GET } = await import('@/app/api/business-rules/run/route')
    const res = await GET(cronRequest())
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.ok).toBe(false)
    expect(body.processed).toBe(2)
    expect(body.failed).toBe(2)
    expect(alertOperatorMock).toHaveBeenCalledTimes(1)
    expect(alertOperatorMock.mock.calls[0][0].key).toBe('cron.business_rules.total_failure')
  })

  it('an unconfigured CRON_SECRET returns 503 before touching any rule logic', async () => {
    // .env.local defines a real CRON_SECRET for local dev, so unstubbing
    // back to "whatever it originally was" would not reproduce "unset" —
    // stub it to an empty string instead, which verifyCronSecret's `if
    // (!cronSecret)` guard treats identically to unset.
    vi.stubEnv('CRON_SECRET', '')
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => makeChain(() => ({ data: [] })) }) }))
    const { GET } = await import('@/app/api/business-rules/run/route')
    const res = await GET(cronRequest())
    expect(res.status).toBe(503)
  })

  it('a wrong cron secret returns 401', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => makeChain(() => ({ data: [] })) }) }))
    const { GET } = await import('@/app/api/business-rules/run/route')
    const res = await GET(new NextRequest('http://localhost/api/x', { headers: { 'x-cron-secret': 'wrong' } }))
    expect(res.status).toBe(401)
  })
})
