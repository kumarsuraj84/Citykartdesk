// QA security tests for the features built after the October VAPT (isolated audit stack only):
//  - the new AC PMS tables and the sheet problem list are server-only (nobody signed in can read or write them through the data API);
//  - the category switches (AC PMS / CVM approval / approval history) cannot be changed by a signed-in user through the data API;
//  - the job routes (/api/pms/daily, /api/masters/sync) refuse a missing or wrong secret and accept the right one;
//  - a vendor of another company cannot read or change an AC PMS ticket;
//  - the approval history shows other requests of the SAME store only, never another store's, and never to someone who cannot decide the approval.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, createTestUser, getAdmin, type D03Fixtures, type TestUser } from '../../tests/setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { NextRequest } from 'next/server'
import { loadApprovalHistory } from '@/lib/approvals/history'
import { canActOnApproval } from '@/lib/approvals/canAct'
import { createAdHocApproval } from '@/lib/approvals/adhoc'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `qs${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
let vendorOther: TestUser, vendorOwn: TestUser
const ids = { coA: '', coB: '', cat: '', catPms: '', sub: '', store1: '', store2: '', pmsTicket: '' }
const made: string[] = []

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  ids.coA = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} A` }).select('id').single()).data.id
  ids.coB = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} B` }).select('id').single()).data.id
  vendorOwn = await createTestUser(`${tag}-own`, 'QA Vendor Own')
  vendorOther = await createTestUser(`${tag}-other`, 'QA Vendor Other')
  await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: ids.coA, vendor_role: 'technician' }).eq('id', vendorOwn.id)
  await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: ids.coB, vendor_role: 'technician' }).eq('id', vendorOther.id)
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} fixtures`, slug: `${tag}-fx`, show_approval_history: true }).select('id').single()).data.id
  ids.catPms = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} pms`, slug: `${tag}-pms`, is_pms: true }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} sub`, slug: `${tag}-sub` }).select('id').single()).data.id
  ids.store1 = (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}1`.toUpperCase(), name: `${tag} Store 1`, address: 'x' }).select('id').single()).data.id
  ids.store2 = (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}2`.toUpperCase(), name: `${tag} Store 2`, address: 'x' }).select('id').single()).data.id
  await a.from('profiles').update({ store_id: ids.store1 }).eq('id', fx.requesterA.id)
  await a.from('profiles').update({ store_id: ids.store2 }).eq('id', fx.requesterB.id)
  const t = (await a.from('requests').insert({
    request_no: '', title: `${tag} pms ticket`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: vendorOwn.id, status: 'open', category_id: ids.catPms,
    form_sections_snapshot: [], form_data: {},
  }).select('id').single()).data.id as string
  ids.pmsTicket = t; made.push(t)
}, 300_000)

afterAll(async () => {
  const a = db()
  if (made.length) {
    const wf = ((await a.from('approvals').select('workflow_id').in('request_id', made)).data ?? []).map((x: { workflow_id: string }) => x.workflow_id)
    await a.from('approval_decisions').delete().in('approval_id', ((await a.from('approvals').select('id').in('request_id', made)).data ?? []).map((x: { id: string }) => x.id))
    await a.from('approvals').delete().in('request_id', made)
    if (wf.length) { await a.from('approval_workflow_steps').delete().in('workflow_id', wf); await a.from('approval_workflows').delete().in('id', wf) }
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('profiles').update({ store_id: null, vendor_company_id: null, vendor_role: null }).in('id', [fx.requesterA.id, fx.requesterB.id, vendorOwn.id, vendorOther.id])
  await a.from('vendor_companies').delete().in('id', [ids.coA, ids.coB].filter(Boolean))
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().in('id', [ids.cat, ids.catPms].filter(Boolean))
  await a.from('stores').delete().in('id', [ids.store1, ids.store2].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

const everyone = (): [string, ReturnType<typeof clientForToken>][] => [
  ['requester', clientForToken(fx.requesterA.accessToken)], ['technician', clientForToken(fx.agentA.accessToken)], ['manager', clientForToken(fx.manager.accessToken)], ['admin', clientForToken(fx.admin.accessToken)],
  ['platform owner', clientForToken(fx.platformOwner.accessToken)], ['vendor', clientForToken(vendorOwn.accessToken)],
]

describe('the AC PMS tables and the sheet problem list are server-only', () => {
  for (const table of ['master_pms_dates', 'pms_ticket_log', 'master_issues', 'master_sources']) {
    it(`${table}: nobody signed in can read it through the data API`, async () => {
      for (const [who, c] of everyone()) {
        const r = await c.from(table as never).select('*').limit(1)
        expect(r.error, `${who} reading ${table}`).not.toBeNull()
        expect(r.data ?? []).toEqual([])
      }
    })
    it(`${table}: nobody signed in can write to it through the data API`, async () => {
      for (const [who, c] of everyone()) {
        const ins = await c.from(table as never).insert({ org_id: fx.orgId, store_code: 'X', pms_date: '2026-01-01', status: 'created' } as never)
        expect(ins.error, `${who} inserting into ${table}`).not.toBeNull()
      }
    })
  }
})

describe('the category switches cannot be flipped through the data API', () => {
  // QA-D002: a manager could. Administrators and platform owners may (their screens write the same rows); nobody else may.
  it('is_pms, auto_cvm_approval and show_approval_history stay as they are for requester, technician, manager and vendor', async () => {
    const others = everyone().filter(([who]) => !['admin', 'platform owner'].includes(who))
    expect(others.map(([w]) => w)).toEqual(['requester', 'technician', 'manager', 'vendor'])
    for (const [who, c] of others) {
      await c.from('service_categories').update({ is_pms: true, auto_cvm_approval: true, show_approval_history: false } as never).eq('id', ids.cat)
      await c.from('service_categories').update({ is_pms: false } as never).eq('id', ids.catPms)
      const a = (await db().from('service_categories').select('is_pms, auto_cvm_approval, show_approval_history').eq('id', ids.cat).single()).data
      const b = (await db().from('service_categories').select('is_pms').eq('id', ids.catPms).single()).data
      expect(a, `${who} changed the fixtures category`).toEqual({ is_pms: false, auto_cvm_approval: false, show_approval_history: true })
      expect(b, `${who} changed the PMS category`).toEqual({ is_pms: true })
    }
  })
  it('the same applies to form templates and technician groups: a manager cannot change them through the data API', async () => {
    const manager = clientForToken(fx.manager.accessToken)
    const tpl = (await db().from('form_templates').insert({ org_id: fx.orgId, name: `${tag} tpl`, form_sections: [] }).select('id').single()).data.id
    const team = (await db().from('teams').insert({ org_id: fx.orgId, name: `${tag} team`, slug: `${tag}-team`, prefix: 'QX', department_id: fx.departmentId }).select('id').single()).data.id
    try {
      await manager.from('form_templates').update({ name: 'hacked' } as never).eq('id', tpl)
      await manager.from('teams').update({ name: 'hacked' } as never).eq('id', team)
      expect((await db().from('form_templates').select('name').eq('id', tpl).single()).data.name).toBe(`${tag} tpl`)
      expect((await db().from('teams').select('name').eq('id', team).single()).data.name).toBe(`${tag} team`)
      const made = await manager.from('teams').insert({ org_id: fx.orgId, name: `${tag} sneaky`, slug: `${tag}-sneaky`, prefix: 'QY', department_id: fx.departmentId } as never)
      expect(made.error).not.toBeNull()
    } finally {
      await db().from('form_templates').delete().eq('id', tpl); await db().from('teams').delete().eq('id', team)
    }
  })
})

describe('the job routes need the shared secret', () => {
  const call = async (route: 'pms/daily' | 'masters/sync', headers: Record<string, string>) => {
    const mod = route === 'pms/daily' ? await import('@/app/api/pms/daily/route') : await import('@/app/api/masters/sync/route')
    return mod.GET(new NextRequest(`http://localhost:3310/api/${route}`, { headers }))
  }
  for (const route of ['pms/daily', 'masters/sync'] as const) {
    it(`/api/${route}: no secret -> 401, wrong secret -> 401, right secret -> 200`, async () => {
      expect((await call(route, {})).status).toBe(401)
      expect((await call(route, { 'x-cron-secret': 'wrong-secret-value' })).status).toBe(401)
      expect((await call(route, { authorization: 'Bearer wrong-secret-value' })).status).toBe(401)
      const ok = await call(route, { 'x-cron-secret': process.env.CRON_SECRET ?? '' })
      expect(ok.status).toBe(200)
    })
  }
})

describe('an AC PMS ticket belongs to its own vendor only', () => {
  it('another company\'s vendor cannot read it, change it or comment on it; the assigned vendor can read it', async () => {
    const other = clientForToken(vendorOther.accessToken)
    const own = clientForToken(vendorOwn.accessToken)
    expect(((await other.from('requests').select('id').eq('id', ids.pmsTicket)).data ?? []).length).toBe(0)
    expect(((await own.from('requests').select('id').eq('id', ids.pmsTicket)).data ?? []).length).toBe(1)
    await other.from('requests').update({ status: 'resolved' } as never).eq('id', ids.pmsTicket)
    expect((await db().from('requests').select('status').eq('id', ids.pmsTicket).single()).data.status).toBe('open')
    const c = await other.from('request_comments').insert({ request_id: ids.pmsTicket, author_id: vendorOther.id, body: 'intruder', is_internal: false } as never)
    expect(c.error).not.toBeNull()
  })
})

describe('the approval history never shows another store, and only the people who can decide see the approval', () => {
  it('store 1 sees only store 1 history; a request of store 2 is not in it', async () => {
    const mk = async (requester: TestUser, qty: number, title: string) => {
      const r = (await db().from('requests').insert({
        request_no: '', title: `${tag} ${title}`, requester_id: requester.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, status: 'in_progress', category_id: ids.cat, sub_category_id: ids.sub,
        form_sections_snapshot: [], form_data: { qty },
      }).select('id, request_no, title, status, requester_id, org_id, waiting_since').single()).data
      made.push(r.id)
      return r
    }
    const earlierOther = await mk(fx.requesterB, 99, 'store two earlier')
    const earlierMine = await mk(fx.requesterA, 5, 'store one earlier')
    const current = await mk(fx.requesterA, 7, 'store one now')
    for (const r of [earlierOther, earlierMine]) {
      const res = await createAdHocApproval(db(), { request: r, approvers: [{ id: fx.agentA.id, full_name: 'QA CVM' }], senderId: r.requester_id, senderName: 'The system' })
      expect(res.error).toBeUndefined()
      const ap = (await db().from('approvals').select('id').eq('request_id', r.id).single()).data.id
      await db().from('approvals').update({ status: 'approved' }).eq('id', ap)
      await db().from('approval_decisions').insert({ approval_id: ap, step_order: 1, decided_by: fx.agentA.id, decision: 'approved', comment: 'ok' })
    }
    const res = await createAdHocApproval(db(), { request: current, approvers: [{ id: fx.agentA.id, full_name: 'QA CVM' }], senderId: fx.requesterA.id, senderName: 'The system' })
    expect(res.error).toBeUndefined()
    const apId = (await db().from('approvals').select('id').eq('request_id', current.id).eq('status', 'pending').single()).data.id
    const h = await loadApprovalHistory(db(), apId)
    expect(h).not.toBeNull()
    expect(h!.earlier.map((r) => r.requestNo)).toEqual([earlierMine.request_no])
    expect(h!.earlier.map((r) => r.requestNo)).not.toContain(earlierOther.request_no)

    // only the named approver can act; the requester, another technician, a manager who is not named and a vendor cannot
    const approval = { id: apId, status: 'pending', current_step: 0, steps: [{ approver_type: 'specific_user', approver_user_id: fx.agentA.id, step_order: 1 }], decisions: [] } as never
    expect(canActOnApproval(approval, fx.agentA.id, 'agent')).toBe(true)
    for (const [uid, role] of [[fx.requesterA.id, 'user'], [fx.agentB.id, 'agent'], [fx.manager.id, 'manager'], [fx.admin.id, 'admin'], [vendorOwn.id, 'user']] as const) {
      expect(canActOnApproval(approval, uid, role as never), `${role} must not be able to decide`).toBe(false)
    }
  })
})
