// D-031: admin actions write with the service-role client, so every id they are given must be checked to belong to the administrator's own
// organisation. Another organisation's group, person, policy or template is refused, and the same action with our own ids still works.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'
import { svc, createUser, deleteUser } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createBusinessRule, updateBusinessRule } from '@/lib/actions/admin/business-rules'
import { upsertWorkflowStep, createWorkflow } from '@/lib/actions/admin/workflows'
import { createService } from '@/lib/actions/admin/services'
import { runRulesForTrigger } from '@/lib/rules/run'

vi.setConfig({ testTimeout: 120_000 })
const db = getAdmin()
const tag = `ref${Date.now()}`
let fx: D03Fixtures
let orgB = ''
let teamB = ''
let personB = ''
const extraUsers: string[] = []
const ruleIds: string[] = []
const requestIds: string[] = []
const workflowIds: string[] = []

beforeAll(async () => {
  fx = await setupD03Fixtures()
  vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
  orgB = (await svc<{ id: string }[]>('POST', '/organizations', { name: `Refs B ${tag}`, slug: `${tag}-b`, status: 'active', seat_limit: 5 }, { Prefer: 'return=representation' })).json[0].id
  const deptB = (await svc<{ id: string }[]>('POST', '/departments', { name: `Dept B ${tag}`, org_id: orgB }, { Prefer: 'return=representation' })).json[0].id
  teamB = (await svc<{ id: string }[]>('POST', '/teams', { name: `Team B ${tag}`, org_id: orgB, slug: `${tag}-tb`, prefix: `Z${Date.now().toString(36).slice(-4).toUpperCase()}`, department_id: deptB }, { Prefer: 'return=representation' })).json[0].id
  const u = await createUser(`${tag}-b@audit.test`, 'Person B'); extraUsers.push(u.id)
  await svc('PATCH', `/profiles?id=eq.${u.id}`, { org_id: orgB, role: 'agent', is_active: true })
  personB = u.id
}, 150_000)
afterAll(async () => {
  if (ruleIds.length) { await db.from('business_rule_events').delete().in('rule_id', ruleIds); await db.from('business_rules').delete().in('id', ruleIds) }
  if (requestIds.length) { await db.from('request_activity').delete().in('request_id', requestIds); await db.from('requests').delete().in('id', requestIds) }
  if (workflowIds.length) await db.from('approval_workflows').delete().in('id', workflowIds)
  for (const id of extraUsers) await deleteUser(id)
  if (teamB) await db.from('teams').delete().eq('id', teamB)
  await svc('POST', '/rpc/owner_delete_org', { p_org_id: orgB }).catch(() => {})
  await fx?.cleanup()
}, 150_000)

const ruleInput = (actions: unknown[]) => ({ name: `${tag} rule`, is_active: true, trigger: ['updated' as const], conditions: [], conditions_logic: 'AND' as const, actions: actions as never, execution_order: 997 })

describe('business rules name only our own groups and people (D-031)', () => {
  it('a rule that points at another organisation\'s group or technician cannot be saved', async () => {
    expect((await createBusinessRule(ruleInput([{ type: 'set_team', params: { teamId: teamB } }]))).error).toMatch(/technician group.*not found/i)
    expect((await createBusinessRule(ruleInput([{ type: 'assign', params: { strategy: 'direct', assigneeIds: [personB] } }]))).error).toMatch(/technician.*not found/i)
    const ok = await createBusinessRule(ruleInput([{ type: 'set_team', params: { teamId: fx.teamA.id } }]))
    expect(ok.error).toBeUndefined()
    ruleIds.push(ok.id!)
    expect((await updateBusinessRule(ok.id!, ruleInput([{ type: 'set_team', params: { teamId: teamB } }]))).error).toMatch(/not found/i)
  })

  it('even a rule that is already saved with a foreign group cannot move a ticket there', async () => {
    const bad = await db.from('business_rules').insert({ org_id: fx.orgId, name: `${tag} stale`, is_active: true, trigger: ['updated'], conditions: [{ field: 'title', operator: 'contains', value: tag }], conditions_logic: 'AND', actions: [{ type: 'set_team', params: { teamId: teamB } }] as never, execution_order: 996 }).select('id').single()
    ruleIds.push(bad.data!.id)
    const t = await db.from('requests').insert({ request_no: '', title: `${tag} ticket`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, org_id: fx.orgId, priority: 'low', status: 'open' }).select('id').single()
    requestIds.push(t.data!.id)
    await runRulesForTrigger('updated', t.data!.id)
    expect((await db.from('requests').select('team_id').eq('id', t.data!.id).single()).data?.team_id).toBe(fx.teamA.id)
  })
})

describe('approval steps and services (D-031)', () => {
  it('an approver from another organisation is refused; one of ours is accepted', async () => {
    const wf = await createWorkflow(`${tag} workflow`)
    expect(wf.error).toBeUndefined()
    workflowIds.push(wf.data!.id)
    expect((await upsertWorkflowStep({ workflowId: wf.data!.id, stepOrder: 1, approverType: 'specific_user', approverUserId: personB })).error).toMatch(/approver not found/i)
    expect((await upsertWorkflowStep({ workflowId: wf.data!.id, stepOrder: 1, approverType: 'specific_user', approverUserId: fx.manager.id })).error).toBeUndefined()
  })

  it('a service cannot be created in a foreign group or with a foreign owner', async () => {
    expect((await createService({ name: `${tag} svc`, team_id: teamB } as never)).error).toMatch(/technician group.*not found/i)
    expect((await createService({ name: `${tag} svc2`, team_id: fx.teamA.id, owner_id: personB } as never)).error).toMatch(/owner.*not found/i)
  })
})
