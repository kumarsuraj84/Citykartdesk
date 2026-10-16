// Remediation phase 2: the permission matrix (who may change company-wide configuration), its switches, the settings allow-list, and what a Business Rule may do.
// (VAPT-006 / 007 / 008 / 009 / 010 / 060)
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateAppSetting, createHoliday } from '@/lib/actions/admin/config'
import { createBusinessRule } from '@/lib/actions/admin/business-rules'
import { createWorkflow } from '@/lib/actions/admin/workflows'
import { setPolicy } from '@/lib/actions/admin/policies'
import { invalidatePolicies } from '@/lib/permissions/policies'
import { can, rolesFor, DEFAULT_POLICIES, POLICY_OPTIONS, type PolicyValues } from '@/lib/permissions/matrix'
import { runRulesForTrigger } from '@/lib/rules/run'
import { isServerTransitionAllowed } from '@/lib/constants/request-transitions'
import { http } from '../remediation/helpers'

vi.setConfig({ testTimeout: 120_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const tag = `p23-${Date.now()}`
const cleanup = { rules: [] as string[], requests: [] as string[], workflows: [] as string[], holidays: [] as string[] }

async function reset() {
  await admin().from('app_settings').delete().like('key', 'policy.%')
  invalidatePolicies()
}
let originalAutoClose: string | null = null   // the setting exists in a normal installation; put it back exactly as found
beforeAll(async () => {
  fx = await setupD03Fixtures()
  originalAutoClose = (await admin().from('app_settings').select('value').eq('key', 'auto_close_days').maybeSingle()).data?.value ?? null
  await reset()
}, 180_000)
beforeEach(reset)
afterAll(async () => {
  await reset()
  if (cleanup.rules.length) { await admin().from('business_rule_events').delete().in('rule_id', cleanup.rules); await admin().from('business_rules').delete().in('id', cleanup.rules) }
  if (cleanup.requests.length) { await admin().from('request_activity').delete().in('request_id', cleanup.requests); await admin().from('request_comments').delete().in('request_id', cleanup.requests); await admin().from('requests').delete().in('id', cleanup.requests) }
  if (cleanup.workflows.length) await admin().from('approval_workflows').delete().in('id', cleanup.workflows)
  if (cleanup.holidays.length) await admin().from('holidays').delete().in('id', cleanup.holidays)
  if (originalAutoClose === null) await admin().from('app_settings').delete().eq('key', 'auto_close_days')
  else await admin().from('app_settings').upsert({ key: 'auto_close_days', value: originalAutoClose }, { onConflict: 'key' })
  await fx?.cleanup()
}, 120_000)

describe('the matrix itself', () => {
  it('the defaults keep today\'s behaviour: managers keep their company-wide powers, reviewers keep their priority choice', () => {
    for (const cap of ['settings.global.write', 'business_rules.write', 'workflows.write'] as const) expect(rolesFor(cap, DEFAULT_POLICIES)).toEqual(['manager', 'admin', 'platform_owner'])
    expect(can('agent', 'intake.priority_override')).toBe(true)
    expect(can('user', 'settings.global.write')).toBe(false)
    expect(can('agent', 'settings.global.write')).toBe(false)
  })
  it('each switch narrows exactly what it says and never widens', () => {
    const p = (o: Partial<PolicyValues>) => ({ ...DEFAULT_POLICIES, ...o }) as PolicyValues
    expect(rolesFor('settings.global.write', p({ global_settings_write: 'admin_up' }))).toEqual(['admin', 'platform_owner'])
    expect(rolesFor('settings.global.write', p({ global_settings_write: 'owner_only' }))).toEqual(['platform_owner'])
    expect(rolesFor('business_rules.write', p({ business_rules_write: 'admin_up' }))).toEqual(['admin', 'platform_owner'])
    expect(rolesFor('workflows.write', p({ workflow_edit: 'admin_up' }))).toEqual(['admin', 'platform_owner'])
    expect(rolesFor('intake.priority_override', p({ intake_priority_override: 'denied' }))).toEqual([])
    // the first option of every switch is the default
    for (const [k, options] of Object.entries(POLICY_OPTIONS)) expect((DEFAULT_POLICIES as Record<string, string>)[k]).toBe(options[0])
  })
  it('services, SLA policies, users and mailbox stay administrator-only whatever the switches say', () => {
    for (const cap of ['services.write', 'sla_policies.write', 'users.admin', 'mailbox.write'] as const) expect(rolesFor(cap)).toEqual(['admin', 'platform_owner'])
  })
})

describe('company-wide settings through the application', () => {
  it('only the settings the screens use are accepted, and with a sensible value', async () => {
    actAs(fx.admin)
    expect((await updateAppSetting('auto_close_days', '7')).error).toBeUndefined()
    expect((await updateAppSetting('auto_close_days', '0')).error).toBeTruthy()
    expect((await updateAppSetting('auto_close_days', 'abc')).error).toBeTruthy()
    expect((await updateAppSetting('policy.global_settings_write', 'manager_up')).error).toBeTruthy()      // the switches have their own action
    expect((await updateAppSetting('approval_reminder_last_run', '2026-01-01')).error).toBeTruthy()          // an internal marker is not for hand editing
    expect((await updateAppSetting('email_from_name', 'IT <script>')).error).toBeTruthy()
  })
  it('by default a manager may still change them (nothing is taken away silently); an ordinary technician may not', async () => {
    actAs(fx.manager)
    expect((await updateAppSetting('auto_close_days', '9')).error).toBeUndefined()
    actAs(fx.agentA)
    expect((await updateAppSetting('auto_close_days', '9')).error).toBeTruthy()
  })
  it('the platform owner can narrow it to administrators, or to platform owners only, and the managers are then refused', async () => {
    actAs(fx.platformOwner)
    expect((await setPolicy('global_settings_write', 'admin_up')).error).toBeUndefined()
    actAs(fx.manager)
    expect((await updateAppSetting('auto_close_days', '10')).error).toBeTruthy()
    expect((await createHoliday({ name: 'x', date: '2030-01-01', is_recurring: false } as never)).error).toBeTruthy()
    actAs(fx.admin)
    expect((await updateAppSetting('auto_close_days', '10')).error).toBeUndefined()
    actAs(fx.platformOwner)
    expect((await setPolicy('global_settings_write', 'owner_only')).error).toBeUndefined()
    actAs(fx.admin)
    expect((await updateAppSetting('auto_close_days', '11')).error).toBeTruthy()
    actAs(fx.platformOwner)
    expect((await updateAppSetting('auto_close_days', '11')).error).toBeUndefined()
  })
  it('only a platform owner can change the switches, and only to valid values', async () => {
    for (const who of [fx.admin, fx.manager, fx.agentA, fx.requesterA]) { actAs(who); expect((await setPolicy('business_rules_write', 'admin_up')).error, who.email).toBeTruthy() }
    actAs(fx.platformOwner)
    expect((await setPolicy('business_rules_write', 'anyone')).error).toBeTruthy()
    expect((await setPolicy('not_a_switch', 'admin_up')).error).toBeTruthy()
  })
  it('the database gives nobody a direct write on these tables either (migration 165)', async () => {
    for (const who of [fx.manager, fx.admin]) {
      const r = await http<unknown>('POST', '/rest/v1/app_settings', { token: who.accessToken, body: { key: 'auto_close_days', value: '1' }, headers: { Prefer: 'return=representation' } })
      expect(r.status, who.email).toBeGreaterThanOrEqual(400)
    }
  })
})

describe('business rules and approval workflows', () => {
  it('a manager may write a rule by default; with the switch on "administrators" only they cannot, administrators can', async () => {
    const make = (name: string) => createBusinessRule({ name, is_active: false, trigger: ['updated'], conditions: [{ field: 'title', operator: 'contains', value: tag }], conditions_logic: 'AND', actions: [{ type: 'set_priority', params: { priority: 'low' } }], execution_order: 999 } as never)
    actAs(fx.manager)
    const ok = await make(`${tag} by manager`)
    expect(ok.error).toBeUndefined()
    if ((ok as { data?: { id: string } }).data?.id) cleanup.rules.push((ok as { data: { id: string } }).data.id)
    actAs(fx.platformOwner)
    expect((await setPolicy('business_rules_write', 'admin_up')).error).toBeUndefined()
    actAs(fx.manager)
    expect((await make(`${tag} refused`)).error).toBeTruthy()
    actAs(fx.admin)
    const adminMade = await make(`${tag} by admin`)
    expect(adminMade.error).toBeUndefined()
    if ((adminMade as { data?: { id: string } }).data?.id) cleanup.rules.push((adminMade as { data: { id: string } }).data.id)
  })
  it('approval workflows follow their own switch', async () => {
    actAs(fx.manager)
    const ok = await createWorkflow(`${tag} wf`)
    expect(ok.error).toBeUndefined()
    if (ok.data?.id) cleanup.workflows.push(ok.data.id)
    actAs(fx.platformOwner)
    await setPolicy('workflow_edit', 'admin_up')
    actAs(fx.manager)
    expect((await createWorkflow(`${tag} wf2`)).error).toBeTruthy()
  })
})

describe('what a Business Rule may do to a ticket', () => {
  async function ticket(status: string) {
    const r = await admin().from('requests').insert({ request_no: '', title: `${tag} ${cleanup.requests.length}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, org_id: fx.orgId, priority: 'low', status: status as never, assigned_to: fx.agentA.id }).select('id').single()
    cleanup.requests.push(r.data!.id)
    return r.data!.id as string
  }
  async function rule(actions: unknown[], titleHas: string) {
    const r = await admin().from('business_rules').insert({ org_id: fx.orgId, name: `${tag} engine rule`, is_active: true, trigger: ['updated'], conditions: [{ field: 'title', operator: 'contains', value: titleHas }], conditions_logic: 'AND', actions: actions as never, execution_order: 997 }).select('id').single()
    cleanup.rules.push(r.data!.id)
  }
  const status = async (id: string) => (await admin().from('requests').select('status').eq('id', id).single()).data!.status

  it('cannot revive a cancelled ticket or close one that was never resolved; can still do the moves a person could', async () => {
    const cancelled = await ticket('cancelled')
    const inProgress = await ticket('in_progress')
    const onHold = await ticket('hold_purchase_ho')
    await rule([{ type: 'set_status', params: { status: 'in_progress' } }], `${cancelled.slice(0, 0)}${tag}`)
    await runRulesForTrigger('updated', cancelled)
    expect(await status(cancelled)).toBe('cancelled')
    await admin().from('business_rules').delete().in('id', cleanup.rules); cleanup.rules.length = 0
    await rule([{ type: 'set_status', params: { status: 'closed' } }], tag)
    await runRulesForTrigger('updated', inProgress)
    expect(await status(inProgress)).toBe('in_progress')                       // in_progress -> closed is not a move anybody may make
    await admin().from('business_rules').delete().in('id', cleanup.rules); cleanup.rules.length = 0
    await rule([{ type: 'set_status', params: { status: 'waiting_user' } }], tag)
    await runRulesForTrigger('updated', inProgress)
    expect(await status(inProgress)).toBe('waiting_user')                      // a normal move still works
    await runRulesForTrigger('updated', onHold)
    expect(await status(onHold)).toBe('hold_purchase_ho')                      // hold -> waiting_user is not allowed
  })

  it('the history names the system, not the requester, for what a rule did (VAPT-060)', async () => {
    const t = await ticket('open')
    await admin().from('business_rules').delete().in('id', cleanup.rules); cleanup.rules.length = 0
    await rule([{ type: 'set_priority', params: { priority: 'urgent' } }], tag)
    await runRulesForTrigger('updated', t)
    const { data } = await admin().from('request_activity').select('actor_id, action, metadata').eq('request_id', t).eq('action', 'priority_changed')
    expect(data?.length).toBeGreaterThan(0)
    for (const a of data ?? []) { expect(a.actor_id).toBeNull(); expect((a.metadata as { via?: string }).via).toBe('business_rule') }
  })

  it('the list of moves a rule may make agrees with the database\'s own list (plus the auto-close step)', async () => {
    const all = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval', 'resolved', 'closed', 'cancelled']
    for (const from of all) {
      for (const to of all) {
        const r = await http<boolean>('POST', '/rest/v1/rpc/request_status_transition_allowed', { token: fx.agentA.accessToken, body: { p_from: from, p_to: to } })
        const inDb = r.text.trim() === 'true'
        const inCode = isServerTransitionAllowed(from, to)
        if (from === 'resolved' && to === 'closed') { expect(inCode).toBe(true); expect(inDb).toBe(false); continue }
        expect(inCode, `${from} -> ${to}`).toBe(inDb)
      }
    }
  })
})
