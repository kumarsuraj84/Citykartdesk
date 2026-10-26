// The "earlier requests of this store" box that goes with an approval request, on the isolated audit stack (mail goes nowhere):
//  - for the same store and the same sub-category it lists the earlier decisions (who, when, which Qty) newest first and adds up the approved Qty;
//  - another store, another sub-category, a category with the box switched off and the request itself are never in it;
//  - the approval mail and the approve page carry it; a category with the box switched off sends the mail as before.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest } from '@/lib/actions/requests'
import { approveApproval, rejectApproval } from '@/lib/actions/approvals'
import { createAdHocApproval } from '@/lib/approvals/adhoc'
import { loadApprovalHistory } from '@/lib/approvals/history'
import { describeApprovalLink } from '@/lib/approvals/email-state'
import { sendNotificationEmail } from '@/lib/email/notify-email'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t39${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const ids = { storeA: '', storeB: '', catOn: '', catOff: '', subOn: '', subOn2: '', subOff: '' }
const made: string[] = []

async function raise(sub: string, qty: number, title: string, who: { accessToken: string } = fx.requesterA) {
  actAs(who)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}`, qty }))
  const r = await createRequest(f)
  expect(r.error).toBeUndefined()
  made.push(r.requestId!)
  return r.requestId!
}
async function sendToCvm(requestId: string) {
  const { data: r } = await db().from('requests').select('id, request_no, title, status, requester_id, org_id, waiting_since').eq('id', requestId).single()
  const res = await createAdHocApproval(db(), { request: r, approvers: [{ id: fx.agentA.id, full_name: 'CVM Agent' }], senderId: r.requester_id, senderName: 'The system' })
  expect(res.error).toBeUndefined()
  return ((await db().from('approvals').select('id').eq('request_id', requestId).eq('status', 'pending').single()).data as { id: string }).id
}
const setStore = (storeId: string | null, who: { id: string } = fx.requesterA) => db().from('profiles').update({ store_id: storeId }).eq('id', who.id)

let nowApproval = ''

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}${c}`.toUpperCase(), name: `${tag} Store ${c}`, address: 'x' }).select('id').single()).data.id as string
  ids.storeA = await mkStore('a'); ids.storeB = await mkStore('b')
  const mkCat = async (name: string, on: boolean) => (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${name}`, slug: `${tag}-${name}`, show_approval_history: on }).select('id').single()).data.id as string
  ids.catOn = await mkCat('fixtures', true); ids.catOff = await mkCat('plain', false)
  const mkSub = async (cat: string, name: string) => {
    const s = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${name}`, slug: `${tag}-${name}` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: s })
    return s
  }
  ids.subOn = await mkSub(ids.catOn, 'shelving'); ids.subOn2 = await mkSub(ids.catOn, 'hangers'); ids.subOff = await mkSub(ids.catOff, 'misc')
  // the form: Qty is ticked "Show in approval history", the subject is not
  await a.from('services').update({
    form_fields: [
      { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 },
      { id: 'qty', type: 'number', label: 'Qty', required: false, order: 2, show_in_approval_history: true },
    ],
  }).eq('id', fx.teamA.serviceId)

  await setStore(ids.storeA)
  // earlier history of store A, sub-category "shelving": 4 approved, then 10 rejected
  const t1 = await raise(ids.subOn, 4, 'shelf one'); actAs(fx.agentA); expect((await approveApproval(await sendToCvm(t1), 'ok for 4')).error).toBeUndefined()
  const t2 = await raise(ids.subOn, 10, 'shelf two'); actAs(fx.agentA); expect((await rejectApproval(await sendToCvm(t2), 'not needed')).error).toBeUndefined()
  // things that must NOT appear: another sub-category of the same store, the same sub-category of another store
  const t3 = await raise(ids.subOn2, 50, 'hanger'); actAs(fx.agentA); await approveApproval(await sendToCvm(t3), 'ok')
  await setStore(ids.storeB, fx.requesterB)
  const t4 = await raise(ids.subOn, 99, 'other store', fx.requesterB); actAs(fx.agentA); await approveApproval(await sendToCvm(t4), 'ok')
  // now: store A asks 6
  const t5 = await raise(ids.subOn, 6, 'shelf now')
  nowApproval = await sendToCvm(t5)
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null); await setStore(null, fx.requesterB)
  if (made.length) {
    const wf = ((await a.from('approvals').select('workflow_id').in('request_id', made)).data ?? []).map((x: { workflow_id: string }) => x.workflow_id)
    await a.from('approvals').delete().in('request_id', made)
    if (wf.length) { await a.from('approval_workflow_steps').delete().in('workflow_id', wf); await a.from('approval_workflows').delete().in('id', wf) }
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  const subs = [ids.subOn, ids.subOn2, ids.subOff].filter(Boolean)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', subs)
  await a.from('service_sub_categories').delete().in('id', subs)
  await a.from('service_categories').delete().in('id', [ids.catOn, ids.catOff].filter(Boolean))
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('earlier requests of the same store and sub-category', () => {
  it('lists the earlier decisions newest first with the Qty, who decided and why it was rejected', async () => {
    const h = await loadApprovalHistory(db(), nowApproval)
    expect(h).not.toBeNull()
    expect(h!.columns).toEqual(['Qty'])
    expect(h!.now).toEqual(['6'])
    expect(h!.category).toContain('shelving')
    expect(h!.storeName).toContain('Store a')
    expect(h!.earlier.map((r) => [r.values[0], r.outcome])).toEqual([['10', 'rejected'], ['4', 'approved']])
    expect(h!.earlier[0].comment).toBe('not needed')
    expect(h!.earlier.every((r) => r.decidedBy !== '' && r.requestNo !== '')).toBe(true)
  })

  it('adds up only the approved Qty and leaves out other stores, other sub-categories and the request itself', async () => {
    const h = (await loadApprovalHistory(db(), nowApproval))!
    expect(h.totals).toEqual([{ label: 'Qty', total: 4, count: 1 }])
    expect(h.earlier.map((r) => r.values[0])).not.toContain('50')
    expect(h.earlier.map((r) => r.values[0])).not.toContain('99')
    expect(h.earlier.map((r) => r.values[0])).not.toContain('6')
  })

  it('shows nothing for a category that has the box switched off', async () => {
    const t = await raise(ids.subOff, 3, 'plain request')
    const approvalId = await sendToCvm(t)
    expect(await loadApprovalHistory(db(), approvalId)).toBeNull()
  })

  it('the approve page and the approval mail carry the box', async () => {
    const state = await describeApprovalLink(db(), nowApproval, fx.agentA.id)
    expect(state.kind).toBe('pending')
    if (state.kind === 'pending') expect(state.detail.history?.earlier).toHaveLength(2)

    vi.mocked(sendEmail).mockClear()
    const res = await sendNotificationEmail({ type: 'approval_requested', recipientEmail: fx.agentA.email, recipientName: 'CVM', data: { approvalId: nowApproval, approverId: fx.agentA.id, requestTitle: `${tag} shelf now`, link: '/requests/x', title: 'Approval required', body: '' } })
    expect(res.error).toBeUndefined()
    const sent = vi.mocked(sendEmail).mock.calls.map((c) => c[0] as { html: string; text?: string })
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain('Earlier requests of this store')
    expect(sent[0].html).toContain('not needed')
    expect(sent[0].text).toContain('Approved in these 12 months: Qty 4')
  })
})
