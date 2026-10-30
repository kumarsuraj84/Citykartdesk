// B-03: converting an e-mail to an "approval" ticket uses only the service's own approval workflow (never "any workflow of the organisation"), refuses a missing or
// stepless workflow BEFORE a ticket is made, and does what the portal's "send for approval" does: who sent it, the status it had, the SLA pause, the history entry
// and a notification to the approver.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb, type Op } from './helpers/fake-db'

let db: FakeDb
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => ({ id: 'u-reviewer', role: 'agent', org_id: 'org-1', full_name: 'Rev Iewer' }) }))
vi.mock('@/lib/actions/moduleGuard', () => ({ requireModuleEnabled: async () => null }))
vi.mock('@/lib/permissions/policies', () => ({ roleMay: async () => false }))
const logActivity = vi.fn(async () => ({}))
vi.mock('@/lib/activity', () => ({ logActivity: (...a: unknown[]) => (logActivity as (...x: unknown[]) => unknown)(...a) }))
const notify = vi.fn(async () => {})
vi.mock('@/lib/notifications', () => ({ notify: (...a: unknown[]) => (notify as (...x: unknown[]) => unknown)(...a) }))
const createRequestCore = vi.fn()
vi.mock('@/lib/requests/create-request-core', () => ({ createRequestCore: (...a: unknown[]) => (createRequestCore as (...x: unknown[]) => unknown)(...a) }))

import { approveAndCreate } from '@/lib/actions/intake/work'

const decision = { final_type: 'approval' as const, final_department: null, final_category: null, final_subcategory: null, final_priority: 'medium' as const }
const payload = { type: 'approval' as const, title: 'Buy a chair', description: 'x', service_id: 'svc1', team_id: 't1' }

function seed(o: { workflowId?: string | null; workflowOrg?: string; steps?: number; fail?: (op: Op) => { message: string; code?: string } | undefined } = {}) {
  const workflowId = o.workflowId === undefined ? 'wf1' : o.workflowId
  db = fakeDb({
    intake_reviews: [{ id: 'rv1', state: 'pending', org_id: 'org-1', message_id: 'm1', thread_id: null, suggested_type: 'approval', suggested_department: null, suggested_priority: 'medium', suggested_confidence: 50, final_type: null, final_priority: null }],
    intake_messages: [{ id: 'm1', org_id: 'org-1', status: 'new' }],
    requests: [],
    services: [{ id: 'svc1', name: 'Purchase', team_id: 't1', approval_workflow_id: workflowId, form_fields: [], form_sections: [], template: null }],
    teams: [{ id: 't1' }],
    intake_classifications: [],
    approval_workflows: [
      { id: 'wf1', org_id: o.workflowOrg ?? 'org-1' },
      { id: 'adhoc-of-another-ticket', org_id: 'org-1' },   // the one the old "any workflow" fallback could pick
    ],
    approval_workflow_steps: Array.from({ length: o.steps ?? 1 }, (_, i) => ({ id: `s${i}`, workflow_id: 'wf1', step_order: i + 1, approver_type: 'specific_user', approver_user_id: 'u-appr' }))
      .concat([{ id: 'sx', workflow_id: 'adhoc-of-another-ticket', step_order: 1, approver_type: 'specific_user', approver_user_id: 'u-stranger' }]),
    approvals: [],
    profiles: [{ id: 'u-appr', full_name: 'Appr Over', org_id: 'org-1' }],
    intake_audit_log: [],
  }, { fail: o.fail })
  createRequestCore.mockImplementation(async () => {
    db.tables.requests.push({ id: 'req1', request_no: 'CK-0001', org_id: 'org-1', status: 'open', waiting_since: null })
    return { requestId: 'req1', requestNo: 'CK-0001' }
  })
}

beforeEach(() => { createRequestCore.mockReset(); logActivity.mockClear(); notify.mockClear() })

describe('intake e-mail converted to an approval ticket', () => {
  it('a service with no approval workflow is refused, and no ticket is made (it used to pick any workflow of the organisation)', async () => {
    seed({ workflowId: null })
    const r = await approveAndCreate('rv1', decision, payload)
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toMatch(/no approval workflow/i)
    expect(createRequestCore).not.toHaveBeenCalled()
    expect(db.tables.approvals).toHaveLength(0)
  })

  it('a workflow with no steps is refused before the ticket exists (no ticket parked for good)', async () => {
    seed({ steps: 0 })
    const r = await approveAndCreate('rv1', decision, payload)
    expect(r).toMatchObject({ ok: false })
    expect(createRequestCore).not.toHaveBeenCalled()
  })

  it('a workflow of another organisation is refused', async () => {
    seed({ workflowOrg: 'org-2' })
    expect(await approveAndCreate('rv1', decision, payload)).toMatchObject({ ok: false })
    expect(createRequestCore).not.toHaveBeenCalled()
  })

  it('sends the ticket for approval like the portal does: sender, previous status, SLA pause, history, notification', async () => {
    seed()
    const r = await approveAndCreate('rv1', decision, payload)
    expect(r).toMatchObject({ ok: true, workId: 'req1' })
    expect(db.tables.approvals).toEqual([expect.objectContaining({ request_id: 'req1', workflow_id: 'wf1', status: 'pending', requested_by: 'u-reviewer' })])
    expect(db.tables.requests[0]).toMatchObject({ status: 'pending_approval', pre_approval_status: 'open' })
    expect(db.tables.requests[0].waiting_since).toBeTruthy()
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'status_changed', metadata: expect.objectContaining({ from: 'open', to: 'pending_approval' }) }))
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'approval_requested' }))
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'u-appr', type: 'approval_requested' }))
    expect(db.tables.intake_reviews[0]).toMatchObject({ state: 'converted', created_request_id: 'req1', created_approval_id: db.tables.approvals[0].id })
  })

  it('if the ticket cannot be put on hold, the approval is withdrawn (not left blocking the ticket)', async () => {
    seed({ fail: (op) => (op.table === 'requests' && op.kind === 'update' ? { message: 'boom' } : undefined) })
    const r = await approveAndCreate('rv1', decision, payload)
    expect(r).toMatchObject({ ok: true })
    expect(db.tables.approvals).toHaveLength(0)
    expect(db.tables.intake_reviews[0].created_approval_id).toBeNull()
  })
})
