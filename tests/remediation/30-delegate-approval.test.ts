// D-016: delegating one approval must not change the shared workflow. Runs against the real (audit) database with the server's service client.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { isolateStepForDelegation } from '@/lib/approvals/isolate-workflow'

let actingProfile: Record<string, unknown> | null = null
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => actingProfile }))
// the user-scoped client is replaced by the service client: this test is about what delegation does to the DATA, not about row security
vi.mock('@/lib/supabase/server', async () => { const { createAdminClient } = await import('@/lib/supabase/admin'); return { createClient: async () => createAdminClient() } })

const ORG = '00000000-0000-0000-0000-000000000001'
const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
const tag = `d16-${Date.now()}`
const created = { workflows: [] as string[], approvals: [] as string[], requests: [] as string[] }
let sharedWf: string, requestA: string, requestB: string, requestC: string, approvalA: string, approvalB: string, mgrId: string, otherId: string

async function makeApproval(requestId: string, workflowId: string) {
  const { data, error } = await admin.from('approvals').insert({ request_id: requestId, workflow_id: workflowId, status: 'pending', current_step: 1 }).select('id').single()
  if (error) throw error
  created.approvals.push(data.id)
  return data.id as string
}

beforeAll(async () => {
  const profiles = (await admin.from('profiles').select('id, role').in('role', ['manager', 'agent']).limit(2)).data
  mgrId = profiles[0].id; otherId = profiles[1].id
  const wf = await admin.from('approval_workflows').insert({ name: `shared ${tag}`, org_id: ORG }).select('id').single()
  sharedWf = wf.data.id; created.workflows.push(sharedWf)
  await admin.from('approval_workflow_steps').insert([{ workflow_id: sharedWf, step_order: 1, approver_type: 'any_manager', approver_user_id: null }, { workflow_id: sharedWf, step_order: 2, approver_type: 'specific_user', approver_user_id: mgrId }])
  const svc = (await admin.from('services').select('id, team_id, requester:id').limit(1)).data[0]
  const requester = (await admin.from('profiles').select('id').eq('role', 'user').limit(1)).data[0].id
  for (const k of ['A', 'B', 'C'] as const) {
    const r = await admin.from('requests').insert({ title: `${tag} ${k}`, requester_id: requester, service_id: svc.id, team_id: svc.team_id, org_id: ORG, status: 'pending_approval', request_no: '' }).select('id').single()
    created.requests.push(r.data.id)
    if (k === 'A') requestA = r.data.id; else if (k === 'B') requestB = r.data.id; else requestC = r.data.id
  }
  approvalA = await makeApproval(requestA, sharedWf)
  approvalB = await makeApproval(requestB, sharedWf)
})
afterAll(async () => {
  for (const id of created.approvals) await admin.from('approvals').delete().eq('id', id)
  for (const id of created.requests) await admin.from('requests').delete().eq('id', id)
  for (const id of created.workflows) { await admin.from('approval_workflow_steps').delete().eq('workflow_id', id); await admin.from('approval_workflows').delete().eq('id', id) }
  const { data: copies } = await admin.from('approval_workflows').select('id').like('name', `Delegated: shared ${tag}`)
  for (const c of copies ?? []) { await admin.from('approval_workflow_steps').delete().eq('workflow_id', c.id); await admin.from('approval_workflows').delete().eq('id', c.id) }
})

const stepsOf = async (wf: string) => (await admin.from('approval_workflow_steps').select('step_order, approver_type, approver_user_id').eq('workflow_id', wf).order('step_order')).data

describe('delegating an approval on a SHARED workflow (the real delegateApproval action)', () => {
  it('changes only that approval: the shared workflow and the other approval are untouched', async () => {
    const { delegateApproval } = await import('@/lib/actions/approvals')
    const before = await stepsOf(sharedWf)
    actingProfile = { id: mgrId, role: 'manager', org_id: ORG, full_name: 'Audit Manager', team_members: [] }
    const r = await delegateApproval(approvalA, otherId)
    expect(r.error).toBeUndefined()

    expect(await stepsOf(sharedWf)).toEqual(before) // the shared workflow still has its "any manager" first step
    const a = (await admin.from('approvals').select('workflow_id').eq('id', approvalA).single()).data
    const b = (await admin.from('approvals').select('workflow_id').eq('id', approvalB).single()).data
    expect(b.workflow_id).toBe(sharedWf) // approval B is unchanged
    expect(a.workflow_id).not.toBe(sharedWf) // approval A now follows its own copy
    created.workflows.push(a.workflow_id)
    const copySteps = await stepsOf(a.workflow_id)
    expect(copySteps[0]).toMatchObject({ step_order: 1, approver_type: 'specific_user', approver_user_id: otherId })
    expect(copySteps[1]).toMatchObject({ step_order: 2, approver_user_id: mgrId }) // later steps were copied unchanged
  })
})

describe('delegating an approval whose workflow belongs only to it (ad hoc)', () => {
  it('changes that workflow in place, with no copy', async () => {
    const wf = await admin.from('approval_workflows').insert({ name: `adhoc ${tag}`, org_id: ORG }).select('id').single()
    created.workflows.push(wf.data.id)
    await admin.from('approval_workflow_steps').insert({ workflow_id: wf.data.id, step_order: 1, approver_type: 'specific_user', approver_user_id: mgrId })
    const ap = await makeApproval(requestC, wf.data.id)
    const iso = await isolateStepForDelegation(admin, { id: ap, workflow_id: wf.data.id }, 1)
    expect('error' in iso).toBe(false)
    if ('error' in iso) return
    expect(iso.copied).toBe(false)
    expect(iso.workflowId).toBe(wf.data.id)
  })
})
