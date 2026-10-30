/**
 * Business Rule actions (lib/rules/actions.ts), with a fake database:
 *  B-02  an "edited" rule only fills an EMPTY slot (or replaces a person who is no longer active); it no longer takes the ticket back from whoever a manager chose
 *  B-19  a round-robin / direct rule skips a person who is inactive or not on the ticket's team, and uses the next valid one
 *  B-20  what one action changed is seen by the next action of the same rule; a rule is never named as "assigned by <the assignee>"
 *  B-30  a priority that is already the ticket's priority changes nothing and logs nothing
 *  B-31  a rule that gives an open ticket to somebody moves it to "assigned", like a manual assignment
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { notifyMock, logActivityMock, requesterNotifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn().mockResolvedValue(undefined),
  logActivityMock: vi.fn().mockResolvedValue({}),
  requesterNotifyMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/notifications', () => ({ notify: notifyMock }))
vi.mock('@/lib/activity', () => ({ logActivity: logActivityMock }))
vi.mock('@/lib/requests/notify-requester', () => ({ notifyRequesterOfAssignment: requesterNotifyMock }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/observability/alert', () => ({ alertOperator: vi.fn() }))
vi.mock('@/lib/settings/reopenWindow', () => ({ getResolvedReopenWindowHours: vi.fn().mockResolvedValue(48) }))

import { executeActions, type ActionRequest, type RuleActionContext } from '@/lib/rules/actions'

type Profile = { id: string; is_active: boolean; org_id: string; vendor_company_id: string | null; vendor_role: string | null }
type Op = { table: string; op: string; payload?: Record<string, unknown>; filters: Array<[string, ...unknown[]]> }

const person = (id: string, over: Partial<Profile> = {}): Profile => ({ id, is_active: true, org_id: 'org-1', vendor_company_id: null, vendor_role: null, ...over })

function fakeAdmin(opts: { profiles: Profile[]; teamMembers: string[]; lastIndex?: number | null }) {
  const ops: Op[] = []
  const admin = {
    ops,
    auth: { admin: { getUserById: vi.fn() } },
    from: (table: string) => {
      const rec: Op = { table, op: 'select', filters: [] }
      const settle = (): unknown => {
        ops.push(rec)
        const has = (m: string) => rec.filters.some(([n]) => n === m)
        const eqVal = (col: string) => rec.filters.find(([n, c]) => n === 'eq' && c === col)?.[2]
        if (table === 'profiles') {
          if (has('in')) { const ids = rec.filters.find(([n]) => n === 'in')![2] as string[]; return { data: opts.profiles.filter((p) => ids.includes(p.id)), error: null } }
          const one = opts.profiles.find((p) => p.id === eqVal('id'))
          return { data: one ?? null, error: null }
        }
        if (table === 'team_members') { const ids = rec.filters.find(([n]) => n === 'in')![2] as string[]; return { data: opts.teamMembers.filter((u) => ids.includes(u)).map((u) => ({ user_id: u })), error: null } }
        if (table === 'business_rules') return rec.op === 'update' ? { data: [{ id: 'rule-1' }], error: null } : { data: { last_assigned_index: opts.lastIndex ?? null }, error: null }
        if (table === 'requests') return rec.op === 'update' ? { data: { id: 'req-1' }, error: null } : { data: [], count: 0, error: null }
        return { data: [], error: null }
      }
      const proxy: unknown = new Proxy(() => {}, {
        get(_t, prop: string) {
          if (prop === 'then') { const p = Promise.resolve().then(settle); return p.then.bind(p) }
          return (...args: unknown[]) => {
            if (prop === 'insert' || prop === 'update' || prop === 'delete') { rec.op = prop; rec.payload = args[0] as Record<string, unknown> }
            else rec.filters.push([prop, ...args])
            return proxy
          }
        },
      })
      return proxy
    },
  }
  return admin
}

function ticket(over: Partial<ActionRequest> = {}): ActionRequest {
  return {
    id: 'req-1', request_no: 'CKSD-000001', title: 'Printer not working', requester_id: 'requester', assigned_to: null, org_id: 'org-1', status: 'open', priority: 'medium',
    service_id: 'svc-1', team_id: 'team-1', created_at: '2026-10-01T00:00:00Z', form_data: {}, waiting_since: null, response_due_at: null, resolution_due_at: null,
    reopen_count: 0, responded_at: null, paused_ms_total: 0, service: { sla_policy: null, form_sections: null, form_fields: null, template: null }, ...over,
  }
}
const ctx = (over: Partial<RuleActionContext> = {}): RuleActionContext => ({ ruleId: 'rule-1', ruleName: 'Route to P', trigger: 'created', ...over })
const assign = (strategy: 'direct' | 'round_robin' | 'load_balanced', ids: string[]) => ({ type: 'assign' as const, params: { strategy, assigneeIds: ids } })
const requestUpdates = (a: ReturnType<typeof fakeAdmin>) => a.ops.filter((o) => o.table === 'requests' && o.op === 'update')

beforeEach(() => { notifyMock.mockClear(); logActivityMock.mockClear(); requesterNotifyMock.mockClear() })

describe('B-02: an assign rule on an EDIT fills an empty slot only', () => {
  it('does not take the ticket back from the person a manager gave it to', async () => {
    const a = fakeAdmin({ profiles: [person('p'), person('manager-choice')], teamMembers: ['p', 'manager-choice'] })
    await executeActions(a, ticket({ assigned_to: 'manager-choice', status: 'assigned' }), [assign('direct', ['p'])], ctx({ trigger: 'updated' }))
    expect(requestUpdates(a)).toHaveLength(0)
    expect(logActivityMock).not.toHaveBeenCalled()
  })

  it('replaces a person who is no longer active', async () => {
    const a = fakeAdmin({ profiles: [person('p'), person('gone', { is_active: false })], teamMembers: ['p', 'gone'] })
    await executeActions(a, ticket({ assigned_to: 'gone', status: 'assigned' }), [assign('direct', ['p'])], ctx({ trigger: 'updated' }))
    expect(requestUpdates(a)[0]?.payload).toMatchObject({ assigned_to: 'p' })
  })

  it('assigns when the ticket has nobody yet, also on an edit', async () => {
    const a = fakeAdmin({ profiles: [person('p')], teamMembers: ['p'] })
    await executeActions(a, ticket(), [assign('direct', ['p'])], ctx({ trigger: 'updated' }))
    expect(requestUpdates(a)[0]?.payload).toMatchObject({ assigned_to: 'p' })
  })

  it('a deliberate re-routing (the category was changed) may replace the current person', async () => {
    const a = fakeAdmin({ profiles: [person('p'), person('old')], teamMembers: ['p', 'old'] })
    await executeActions(a, ticket({ assigned_to: 'old', status: 'assigned' }), [assign('direct', ['p'])], ctx({ trigger: 'updated', allowReassign: true }))
    expect(requestUpdates(a)[0]?.payload).toMatchObject({ assigned_to: 'p' })
  })

  it('a creation rule keeps its behaviour: it assigns whoever it names', async () => {
    const a = fakeAdmin({ profiles: [person('p'), person('old')], teamMembers: ['p', 'old'] })
    await executeActions(a, ticket({ assigned_to: 'old', status: 'assigned' }), [assign('direct', ['p'])], ctx({ trigger: 'created' }))
    expect(requestUpdates(a)[0]?.payload).toMatchObject({ assigned_to: 'p' })
  })

  it('a ticket that is with a vendor technician is never taken away', async () => {
    const a = fakeAdmin({ profiles: [person('p'), person('oem', { vendor_company_id: 'v1', vendor_role: 'technician' })], teamMembers: ['p'] })
    await executeActions(a, ticket({ assigned_to: 'oem', status: 'in_progress' }), [assign('direct', ['p'])], ctx({ trigger: 'created' }))
    expect(requestUpdates(a)).toHaveLength(0)
  })
})

describe('B-31 (owner decision pending): a rule that assigns an open ticket keeps it "open", as the live system does', () => {
  it('open stays open, guarded by the status that was read', async () => {
    const a = fakeAdmin({ profiles: [person('p')], teamMembers: ['p'] })
    await executeActions(a, ticket({ status: 'open' }), [assign('direct', ['p'])], ctx())
    const u = requestUpdates(a)[0]
    expect(u.payload).toEqual({ assigned_to: 'p' })
    expect(u.filters).toContainEqual(['eq', 'status', 'open'])
  })

  it('a ticket that is already in progress keeps its status', async () => {
    const a = fakeAdmin({ profiles: [person('p')], teamMembers: ['p'] })
    await executeActions(a, ticket({ status: 'in_progress' }), [assign('direct', ['p'])], ctx())
    expect(requestUpdates(a)[0].payload).toEqual({ assigned_to: 'p' })
  })
})

describe('B-19: invalid candidates are skipped', () => {
  it('direct: the first listed person is inactive, so the next valid one is used', async () => {
    const a = fakeAdmin({ profiles: [person('a', { is_active: false }), person('b')], teamMembers: ['a', 'b'] })
    await executeActions(a, ticket(), [assign('direct', ['a', 'b'])], ctx())
    expect(requestUpdates(a)[0].payload).toMatchObject({ assigned_to: 'b' })
  })

  it('round robin: the turn lands on a person who is not on the team, so the next valid one gets the ticket and the position moves past them', async () => {
    const a = fakeAdmin({ profiles: [person('a'), person('b'), person('c')], teamMembers: ['a', 'c'], lastIndex: 1 })
    await executeActions(a, ticket(), [assign('round_robin', ['a', 'b', 'c'])], ctx())
    expect(requestUpdates(a).find((o) => o.payload && 'assigned_to' in o.payload)?.payload).toMatchObject({ assigned_to: 'c' })
    const claim = a.ops.find((o) => o.table === 'business_rules' && o.op === 'update')
    expect(claim?.payload).toEqual({ last_assigned_index: 0 })   // after c (index 2) comes a (index 0)
  })

  it('nobody valid: nothing is assigned and the position is not moved', async () => {
    const a = fakeAdmin({ profiles: [person('a', { is_active: false })], teamMembers: ['a'], lastIndex: 0 })
    await executeActions(a, ticket(), [assign('round_robin', ['a'])], ctx())
    expect(requestUpdates(a)).toHaveLength(0)
    expect(a.ops.some((o) => o.table === 'business_rules' && o.op === 'update')).toBe(false)
  })

  it('a vendor technician (on no team) is still a valid candidate', async () => {
    const a = fakeAdmin({ profiles: [person('oem', { vendor_company_id: 'v1', vendor_role: 'technician' })], teamMembers: [] })
    await executeActions(a, ticket(), [assign('direct', ['oem'])], ctx())
    expect(requestUpdates(a)[0].payload).toMatchObject({ assigned_to: 'oem' })
  })
})

describe('B-20: the next action sees what the first one changed, and nobody is named as the assigner', () => {
  it('assign then notify-the-assignee tells the NEW assignee', async () => {
    const a = fakeAdmin({ profiles: [person('p')], teamMembers: ['p'] })
    await executeActions(a, ticket(), [
      assign('direct', ['p']),
      { type: 'notify', params: { roles: [], notifyAssignee: true, notifyRequester: false, channels: ['in_app'] } },
    ], ctx())
    const rows = notifyMock.mock.calls.flatMap((c) => c[0] as Array<{ recipientId: string; type: string; actorId: string | null }>)
    expect(rows.filter((r) => r.type === 'business_rule_notification').map((r) => r.recipientId)).toEqual(['p'])
  })

  it('the assignment notice has no person as its actor (it used to be the assignee himself)', async () => {
    const a = fakeAdmin({ profiles: [person('p')], teamMembers: ['p'] })
    await executeActions(a, ticket(), [assign('direct', ['p'])], ctx())
    const row = (notifyMock.mock.calls[0][0] as Array<{ actorId: string | null; recipientId: string; metadata?: Record<string, string> }>)[0]
    expect(row.recipientId).toBe('p')
    expect(row.actorId).toBeNull()
    expect(row.metadata?.assignerName).toBe('Business rule: Route to P')
  })
})

describe('B-30: setting the priority it already has does nothing', () => {
  it('no write, no history entry', async () => {
    const a = fakeAdmin({ profiles: [], teamMembers: [] })
    await executeActions(a, ticket({ priority: 'high' }), [{ type: 'set_priority', params: { priority: 'high' } }], ctx({ trigger: 'updated' }))
    expect(requestUpdates(a)).toHaveLength(0)
    expect(logActivityMock).not.toHaveBeenCalled()
  })

  it('a different priority on a finished ticket is recorded without touching the deadlines', async () => {
    const a = fakeAdmin({ profiles: [], teamMembers: [] })
    await executeActions(a, ticket({ priority: 'low', status: 'closed' }), [{ type: 'set_priority', params: { priority: 'high' } }], ctx({ trigger: 'updated' }))
    expect(requestUpdates(a)[0].payload).toEqual({ priority: 'high' })
  })
})
