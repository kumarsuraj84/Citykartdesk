/**
 * H-03 / B-15 / B-07 / B-14 for lib/requests/status-change.ts#applyStatusChange, with a mocked database client that can fail each write:
 *  - once the status has changed, a failing follow-up (timer stop, survey, comment, history entry, Business Rules, vendor mail ...) is LOGGED and the call still succeeds
 *    (the user used to get an error for something that already happened, and a retry failed or repeated it);
 *  - a failed SLA reset on a reopen is retried once, and when both tries fail it is logged as an error with the request id;
 *  - a failed status write itself is still reported;
 *  - cancel / resolve also tell the technician and the collaborators (never the person who did it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { loggerErrorMock, notifyMock, logActivityMock, runRulesMock, issueCsatMock, audienceMock, resolveSlaMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  notifyMock: vi.fn().mockResolvedValue(undefined),
  logActivityMock: vi.fn().mockResolvedValue({}),
  runRulesMock: vi.fn().mockResolvedValue(undefined),
  issueCsatMock: vi.fn().mockResolvedValue({ emailed: false }),
  audienceMock: vi.fn(),
  resolveSlaMock: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/observability/logger', () => ({ logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/notifications', () => ({ notify: notifyMock, getRequestAudience: audienceMock }))
vi.mock('@/lib/activity', () => ({ logActivity: logActivityMock }))
vi.mock('@/lib/rules/run', () => ({ runRulesForTrigger: runRulesMock }))
vi.mock('@/lib/csat/issue', () => ({ issueCsat: issueCsatMock }))
vi.mock('@/lib/settings/reopenWindow', () => ({ getResolvedReopenWindowHours: vi.fn().mockResolvedValue(48) }))
vi.mock('@/lib/sla/resolve', () => ({ resolveSlaDeadlines: resolveSlaMock }))
vi.mock('@/lib/sla/business-hours', () => ({
  pauseCreditMs: vi.fn(async (a: Date, b: Date) => b.getTime() - a.getTime()),
  shiftDeadlineByCredit: vi.fn(async (d: Date, ms: number) => new Date(d.getTime() + ms)),
}))
vi.mock('@/lib/vendor/ticket-fields', () => ({ clearOemTicketOnReopen: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/vendor/requests', () => ({ cancelOpenRequest: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/vendor/ticket-notify', () => ({ tellVendorHoldEnded: vi.fn(), tellVendorReopened: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/requests/master-routing', () => ({ resendOemOnReopen: vi.fn().mockResolvedValue(undefined) }))

// the server's database client: each table answers from `world`, and `fail` names the writes that must fail
const world: { request: Record<string, unknown>; fail: Set<string>; ops: Array<{ table: string; op: string; payload?: Record<string, unknown> }> } = { request: {}, fail: new Set(), ops: [] }
const boom = { message: 'simulated failure', code: 'XX000' }

function chain(table: string, answer: (rec: { op: string; payload?: Record<string, unknown>; filters: string[] }) => unknown) {
  const rec = { op: 'select', payload: undefined as Record<string, unknown> | undefined, filters: [] as string[] }
  const proxy: unknown = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        const p = Promise.resolve().then(() => { world.ops.push({ table, op: rec.op, payload: rec.payload }); return answer(rec) })
        return p.then.bind(p)
      }
      return (...args: unknown[]) => {
        if (prop === 'insert' || prop === 'update' || prop === 'delete') { rec.op = prop; rec.payload = args[0] as Record<string, unknown> } else rec.filters.push(prop)
        return proxy
      }
    },
  })
  return proxy
}

function db() {
  return {
    from: (table: string) => chain(table, (rec) => {
      if (table === 'requests') {
        if (rec.op === 'update') {
          const resetWrite = rec.payload && 'paused_ms_total' in rec.payload && rec.payload.paused_ms_total === 0 && !('status' in rec.payload)
          if (resetWrite && world.fail.has('sla_reset')) return { data: null, error: boom }
          if (!resetWrite && world.fail.has('status')) return { data: null, error: boom }
          return { data: { id: 'req-1' }, error: null }
        }
        return { data: { ...world.request, service: { sla_policy: null, form_sections: [], form_fields: [], template: null } }, error: null }
      }
      if (table === 'request_time_entries') return rec.op === 'select' ? { data: null, error: null } : { data: null, error: world.fail.has('timer') ? boom : null }
      if (table === 'request_comments') return world.fail.has('comment') ? { data: null, error: boom } : { data: { id: 'c-1' }, error: null }
      return { data: null, error: null }
    }),
  }
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db() }))

import { applyStatusChange, type StatusActor } from '@/lib/requests/status-change'

function actor(over: Record<string, unknown> = {}): StatusActor {
  const supabase = { from: (table: string) => chain(table, () => ({ data: table === 'requests' ? world.request : { full_name: 'Someone' }, error: null })) }
  return {
    supabase: supabase as never,
    profile: { id: 'agent-1', full_name: 'Agent One', role: 'agent', org_id: 'org-1', team_members: [{ team_id: 'team-1' }], vendor_company_id: null, vendor_role: null, ...over } as never,
  }
}

const NOTE = 'Cable was damaged. Replaced the cable and tested the payment.'

beforeEach(() => {
  world.fail = new Set()
  world.ops = []
  world.request = {
    id: 'req-1', request_no: 'CKSD-000001', status: 'in_progress', priority: 'medium', requester_id: 'req-user', team_id: 'team-1', assigned_to: 'tech-1', responded_at: '2026-10-01T00:00:00Z',
    waiting_since: null, response_due_at: null, resolution_due_at: '2026-10-05T00:00:00Z', resolved_at: null, form_data: {}, category_id: null, form_sections_snapshot: [], form_schema_snapshot: [],
    cancellation_reason: null, reopen_deadline_at: null, reopen_count: 0, paused_ms_total: 0, service_id: 'svc-1',
  }
  loggerErrorMock.mockClear(); notifyMock.mockClear(); logActivityMock.mockClear(); runRulesMock.mockClear(); issueCsatMock.mockClear()
  logActivityMock.mockResolvedValue({}); runRulesMock.mockResolvedValue(undefined); issueCsatMock.mockResolvedValue({ emailed: false })
  resolveSlaMock.mockReset(); resolveSlaMock.mockResolvedValue({ responseDueAt: null, resolutionDueAt: '2026-11-01T00:00:00.000Z' })
  audienceMock.mockResolvedValue({ requesterId: 'req-user', assigneeId: 'tech-1', collaboratorIds: ['collab-1', 'agent-1'] })
})

const events = () => loggerErrorMock.mock.calls.map((c) => c[0] as { event: string; requestId?: string })

describe('H-03 / B-15: the status changed, so a failing follow-up does not make the call fail', () => {
  it('resolve: the timer stop, the survey, the comment, the history entry and the Business Rules all fail -> still no error, and every failure is logged', async () => {
    world.fail = new Set(['timer', 'comment'])
    issueCsatMock.mockRejectedValue(new Error('survey down'))
    logActivityMock.mockResolvedValue({ error: 'Activity log failed: down' })
    runRulesMock.mockRejectedValue(new Error('rules down'))

    const r = await applyStatusChange(actor(), 'req-1', 'resolved', NOTE)
    expect(r.error).toBeUndefined()
    const names = events().map((e) => e.event)
    expect(names).toEqual(expect.arrayContaining(['time_entries.stop_failed', 'status_change.csat_failed', 'status_change.activity_missing', 'status_change.comment_failed', 'status_change.rules_failed']))
    // the status itself was written exactly once
    expect(world.ops.filter((o) => o.table === 'requests' && o.op === 'update' && o.payload?.status === 'resolved')).toHaveLength(1)
  })

  it('a failed history entry alone does not turn a saved change into an error', async () => {
    logActivityMock.mockResolvedValue({ error: 'Activity log failed: down' })
    const r = await applyStatusChange(actor(), 'req-1', 'waiting_user', 'Please send the photo of the cable.')
    expect(r.error).toBeUndefined()
  })

  it('the status write itself failing IS reported, and nothing after it runs', async () => {
    world.fail = new Set(['status'])
    const r = await applyStatusChange(actor(), 'req-1', 'resolved', NOTE)
    expect(r.error).toBeTruthy()
    expect(issueCsatMock).not.toHaveBeenCalled()
    expect(logActivityMock).not.toHaveBeenCalled()
  })
})

describe('H-03: a reopen resets the SLA clock, retried once and logged when it cannot', () => {
  beforeEach(() => { world.request.status = 'resolved'; world.request.resolved_at = '2026-10-02T00:00:00Z' })

  it('fails once, works on the second try: no error is logged', async () => {
    let calls = 0
    resolveSlaMock.mockImplementation(async () => { if (++calls === 1) throw new Error('calendar down'); return { responseDueAt: null, resolutionDueAt: '2026-11-01T00:00:00.000Z' } })
    const r = await applyStatusChange(actor(), 'req-1', 'open', 'The fix did not hold, it is broken again.')
    expect(r.error).toBeUndefined()
    expect(calls).toBe(2)
    expect(events().filter((e) => e.event === 'status_change.reopen_sla_reset_failed')).toHaveLength(0)
    expect(world.ops.some((o) => o.table === 'requests' && o.payload?.paused_ms_total === 0 && o.payload?.resolution_due_at === '2026-11-01T00:00:00.000Z')).toBe(true)
  })

  it('fails both times: still no error for the user, an error with the request id is logged', async () => {
    resolveSlaMock.mockRejectedValue(new Error('calendar down'))
    const r = await applyStatusChange(actor(), 'req-1', 'open', 'The fix did not hold, it is broken again.')
    expect(r.error).toBeUndefined()
    expect(resolveSlaMock).toHaveBeenCalledTimes(2)
    const failed = events().filter((e) => e.event === 'status_change.reopen_sla_reset_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].requestId).toBe('req-1')
  })

  it('the reset write failing is handled the same way', async () => {
    world.fail = new Set(['sla_reset'])
    const r = await applyStatusChange(actor(), 'req-1', 'open', 'The fix did not hold, it is broken again.')
    expect(r.error).toBeUndefined()
    expect(events().filter((e) => e.event === 'status_change.reopen_sla_reset_failed')).toHaveLength(1)
  })
})

describe('B-14: cancel and resolve also tell the technician and the collaborators', () => {
  const told = () => notifyMock.mock.calls.flatMap((c) => (Array.isArray(c[0]) ? c[0] : [c[0]]) as Array<{ recipientId: string; type: string }>)

  it('resolve: the requester, the technician and the collaborator are told; the person who did it is not', async () => {
    await applyStatusChange(actor(), 'req-1', 'resolved', NOTE)
    const ids = told().map((n) => n.recipientId).sort()
    expect(ids).toEqual(['collab-1', 'req-user', 'tech-1'])
  })

  it('cancel: the same', async () => {
    await applyStatusChange(actor(), 'req-1', 'cancelled', 'Raised twice by mistake, the other ticket is open.')
    const ids = told().filter((n) => n.type === 'request_cancelled').map((n) => n.recipientId).sort()
    expect(ids).toEqual(['collab-1', 'req-user', 'tech-1'])
  })

  it('the technician who resolves his own ticket is not told about it', async () => {
    await applyStatusChange(actor({ id: 'tech-1' }), 'req-1', 'resolved', NOTE)
    expect(told().map((n) => n.recipientId)).not.toContain('tech-1')
  })

  it('a failing audience lookup does not fail the call', async () => {
    audienceMock.mockRejectedValue(new Error('down'))
    const r = await applyStatusChange(actor(), 'req-1', 'resolved', NOTE)
    expect(r.error).toBeUndefined()
    expect(events().some((e) => e.event === 'status_change.follow_up_failed')).toBe(true)
  })
})

describe('B-07: a finished ticket never keeps a running timer', () => {
  it('cancelling a ticket that is not in progress still stops its open timers', async () => {
    world.request.status = 'assigned'
    await applyStatusChange(actor(), 'req-1', 'cancelled', 'Raised twice by mistake, the other ticket is open.')
    expect(world.ops.some((o) => o.table === 'request_time_entries' && o.op === 'update' && 'stopped_at' in (o.payload ?? {}))).toBe(true)
  })
})
