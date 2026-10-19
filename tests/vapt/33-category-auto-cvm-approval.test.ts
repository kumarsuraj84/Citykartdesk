// Automatic approval by the store's CVM (a category set to it), on the isolated audit stack:
//  - a ticket under such a category goes In Process, is sent for approval to the CVM of the requester's store, and waits in Pending Approval;
//  - when the CVM approves, the normal flow puts it back In Process; when the CVM rejects, it is cancelled;
//  - no CVM / the requester is the CVM / an inactive CVM: the ticket stays Open with an internal note and no approval is created;
//  - a category without the setting is a normal ticket.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest } from '@/lib/actions/requests'
import { approveApproval, rejectApproval } from '@/lib/actions/approvals'
import { setCategoryCvmApproval } from '@/lib/actions/admin/categories'

vi.setConfig({ testTimeout: 180_000 })
const admin = () => getAdmin()
const tag = `t33-${Date.now()}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const ids = { store: '', storeNoCvm: '', catFixture: '', catPlain: '', subFixture: '', subPlain: '' }
const made: string[] = []

const form = (sub: string, title: string) => {
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub); f.set('form_data', JSON.stringify({ subject: `${tag} ${title}` }))
  return f
}
const setStore = (storeId: string | null) => admin().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)
async function raise(sub: string, title: string) {
  actAs(fx.requesterA)
  const r = await createRequest(form(sub, title))
  expect(r.error, JSON.stringify(r)).toBeUndefined()
  made.push(r.requestId!)
  const t = (await admin().from('requests').select('id, status, pre_approval_status').eq('id', r.requestId!).single()).data!
  const approvals = (await admin().from('approvals').select('id, status, requested_by').eq('request_id', t.id)).data ?? []
  const comments = (await admin().from('request_comments').select('body, is_internal').eq('request_id', t.id)).data ?? []
  const steps = approvals.length ? (await admin().from('approval_workflow_steps').select('approver_user_id, workflow_id').in('workflow_id', (await admin().from('approvals').select('workflow_id').eq('request_id', t.id)).data!.map((a) => a.workflow_id))).data ?? [] : []
  return { id: t.id, status: t.status, pre: t.pre_approval_status, approvals, comments, approverIds: steps.map((s) => s.approver_user_id) }
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = admin()
  const mkStore = async (code: string, cvm: string | null) => (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}-${code}`.toUpperCase(), name: `${tag} ${code}`, cvm_id: cvm } as never).select('id').single()).data!.id as string
  ids.store = await mkStore('with-cvm', fx.agentA.id); ids.storeNoCvm = await mkStore('no-cvm', null)
  const mkCat = async (name: string, on: boolean) => (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${name}`, slug: `${tag}-${name}`, auto_cvm_approval: on } as never).select('id').single()).data!.id as string
  ids.catFixture = await mkCat('fixture', true); ids.catPlain = await mkCat('plain', false)
  const mkSub = async (cat: string, name: string) => {
    const s = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${name}`, slug: `${tag}-${name}` } as never).select('id').single()).data!.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: s } as never)
    return s
  }
  ids.subFixture = await mkSub(ids.catFixture, 'sub-fixture'); ids.subPlain = await mkSub(ids.catPlain, 'sub-plain')
}, 300_000)

afterAll(async () => {
  const a = admin()
  await setStore(null)
  if (made.length) {
    const wf = (await a.from('approvals').select('workflow_id').in('request_id', made)).data?.map((x) => x.workflow_id) ?? []
    await a.from('approvals').delete().in('request_id', made)
    if (wf.length) { await a.from('approval_workflow_steps').delete().in('workflow_id', wf); await a.from('approval_workflows').delete().in('id', wf) }
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('service_sub_category_tags').delete().in('sub_category_id', [ids.subFixture, ids.subPlain].filter(Boolean))
  await a.from('service_sub_categories').delete().in('id', [ids.subFixture, ids.subPlain].filter(Boolean))
  await a.from('service_categories').delete().in('id', [ids.catFixture, ids.catPlain].filter(Boolean))
  await a.from('stores').delete().in('id', [ids.store, ids.storeNoCvm].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('a category that sends to the CVM automatically', () => {
  it('puts the ticket on hold in Pending Approval with one pending approval for the store\'s CVM, remembering that it was In Process', async () => {
    await setStore(ids.store)
    const t = await raise(ids.subFixture, 'fixtures approve')
    expect(t.status).toBe('pending_approval')
    expect(t.pre).toBe('in_progress')
    expect(t.approvals).toHaveLength(1)
    expect(t.approvals[0].status).toBe('pending')
    expect(t.approverIds).toEqual([fx.agentA.id])
    expect(t.comments.some((c) => !c.is_internal && /taken into process automatically and sent for approval to .*the CVM of your store/.test(c.body))).toBe(true)
    // the history shows In Process first, then the hold
    const act = (await admin().from('request_activity').select('action, metadata').eq('request_id', t.id).order('created_at', { ascending: true })).data ?? []
    const moves = act.filter((x) => x.action === 'status_changed').map((x) => (x.metadata as { to?: string }).to)
    expect(moves).toEqual(['in_progress', 'pending_approval'])
  })
  it('when the CVM approves, the ticket returns to In Process by the normal approval flow', async () => {
    await setStore(ids.store)
    const t = await raise(ids.subFixture, 'fixtures approved')
    actAs(fx.agentA)
    const r = await approveApproval(t.approvals[0].id, 'ok')
    expect(r.error).toBeUndefined()
    const after = (await admin().from('requests').select('status').eq('id', t.id).single()).data!
    expect(after.status).toBe('in_progress')
  })
  it('when the CVM rejects, the ticket is cancelled', async () => {
    await setStore(ids.store)
    const t = await raise(ids.subFixture, 'fixtures rejected')
    actAs(fx.agentA)
    const r = await rejectApproval(t.approvals[0].id, 'not needed')
    expect(r.error).toBeUndefined()
    expect((await admin().from('requests').select('status').eq('id', t.id).single()).data!.status).toBe('cancelled')
  })
  it('a store with no CVM: the ticket stays Open, no approval is created, an internal note tells the technician', async () => {
    await setStore(ids.storeNoCvm)
    const t = await raise(ids.subFixture, 'fixtures no cvm')
    expect(t.status).toBe('open')
    expect(t.approvals).toHaveLength(0)
    expect(t.comments.some((c) => c.is_internal && /No CVM is tagged to this store/.test(c.body))).toBe(true)
  })
  it('a requester without a store, or whose CVM is themself: Open, no approval, internal note', async () => {
    await setStore(null)
    const a = await raise(ids.subFixture, 'fixtures no store')
    expect(a.status).toBe('open'); expect(a.approvals).toHaveLength(0)
    expect(a.comments.some((c) => c.is_internal && /not linked to a store/.test(c.body))).toBe(true)
    await admin().from('stores').update({ cvm_id: fx.agentA.id } as never).eq('id', ids.storeNoCvm)
    await setStore(ids.storeNoCvm)
    await admin().from('profiles').update({ store_id: ids.storeNoCvm }).eq('id', fx.agentA.id)
    actAs(fx.agentA)
    const r = await createRequest(form(ids.subFixture, 'fixtures self cvm'))
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    made.push(r.requestId!)
    const row = (await admin().from('requests').select('status').eq('id', r.requestId!).single()).data!
    expect(row.status).toBe('open')
    expect((await admin().from('approvals').select('id').eq('request_id', r.requestId!)).data).toHaveLength(0)
    await admin().from('profiles').update({ store_id: null }).eq('id', fx.agentA.id)
    await admin().from('stores').update({ cvm_id: null } as never).eq('id', ids.storeNoCvm)
  })
  it('a category without the setting is a normal ticket', async () => {
    await setStore(ids.store)
    const t = await raise(ids.subPlain, 'paint')
    expect(t.status).toBe('open')
    expect(t.approvals).toHaveLength(0)
  })
})

describe('the setting is changed only by an administrator', () => {
  it('an admin switches it on and off; a requester is refused', async () => {
    actAs(fx.admin)
    expect((await setCategoryCvmApproval(ids.catPlain, true)).error).toBeUndefined()
    expect((await admin().from('service_categories').select('auto_cvm_approval').eq('id', ids.catPlain).single()).data!.auto_cvm_approval).toBe(true)
    expect((await setCategoryCvmApproval(ids.catPlain, false)).error).toBeUndefined()
    actAs(fx.requesterA)
    expect((await setCategoryCvmApproval(ids.catPlain, true)).error).toBeTruthy()
    expect((await admin().from('service_categories').select('auto_cvm_approval').eq('id', ids.catPlain).single()).data!.auto_cvm_approval).toBe(false)
  })
})
