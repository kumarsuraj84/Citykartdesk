// D-021: the approvals CSV export lost its "Decisions" column silently once there were a few hundred approvals (one request carried every id and was
// too long). Runs on the real (audit) database with enough approvals to reproduce it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { exportApprovalsCSV } from '@/lib/export/reports'
import { ORG_A } from './helpers'

const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
const N = 650
const tag = `d21-${Date.now()}`
let workflowId: string, requestId: string, deciderId: string
const approvalIds: string[] = []

beforeAll(async () => {
  deciderId = (await admin.from('profiles').select('id').eq('role', 'manager').limit(1)).data[0].id
  const svc = (await admin.from('services').select('id, team_id').limit(1)).data[0]
  const requester = (await admin.from('profiles').select('id').eq('role', 'user').limit(1)).data[0].id
  requestId = (await admin.from('requests').insert({ title: tag, requester_id: requester, service_id: svc.id, team_id: svc.team_id, org_id: ORG_A, status: 'resolved', request_no: '' }).select('id').single()).data.id
  workflowId = (await admin.from('approval_workflows').insert({ name: tag, org_id: ORG_A }).select('id').single()).data.id
  const rows = Array.from({ length: N }, () => ({ request_id: requestId, workflow_id: workflowId, current_step: 1, status: 'approved' }))
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin.from('approvals').insert(rows.slice(i, i + 200)).select('id')
    if (error) throw error
    approvalIds.push(...data.map((r: { id: string }) => r.id))
  }
  for (let i = 0; i < approvalIds.length; i += 200) {
    const { error } = await admin.from('approval_decisions').insert(approvalIds.slice(i, i + 200).map((id) => ({ approval_id: id, step_order: 1, decided_by: deciderId, decision: 'approved' })))
    if (error) throw error
  }
}, 120_000)

afterAll(async () => {
  for (let i = 0; i < approvalIds.length; i += 200) {
    const ids = approvalIds.slice(i, i + 200)
    await admin.from('approval_decisions').delete().in('approval_id', ids)
    await admin.from('approvals').delete().in('id', ids)
  }
  await admin.from('approval_workflows').delete().eq('id', workflowId)
  await admin.from('requests').delete().eq('id', requestId)
}, 120_000)

describe('exportApprovalsCSV with hundreds of approvals', () => {
  it('every approval row keeps its decision text', async () => {
    const csv = await exportApprovalsCSV(ORG_A, { status: 'approved' } as never)
    const mine = csv.split('\n').filter((l) => l.includes(tag))
    expect(mine).toHaveLength(N)
    const withDecision = mine.filter((l) => /Approved \(step 1\)/.test(l))
    expect(withDecision).toHaveLength(N)
  }, 120_000)
})
