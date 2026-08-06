import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ApprovalStatus, RequestPriority, RequestStatus } from '@/types'
import type { Tables } from '@/types/database'

// ── Enriched approval type ────────────────────────────────────────────────────

export type ApprovalDecisionRow = Tables<'approval_decisions'> & {
  decider: { id: string; full_name: string } | null
}

export type ApprovalWorkflowStepRow = Tables<'approval_workflow_steps'> & {
  approver: { id: string; full_name: string } | null
}

export type ApprovalWithDetails = {
  id: string
  request_id: string
  workflow_id: string
  current_step: number | null
  status: ApprovalStatus
  created_at: string
  updated_at: string
  request: {
    id: string
    request_no: string
    title: string
    requester_id: string
    priority: RequestPriority
    status: RequestStatus
    created_at: string
    requester: { id: string; full_name: string } | null
    service: { id: string; name: string; icon: string | null } | null
    team: { id: string; name: string } | null
  }
  workflow: {
    id: string
    name: string
  } | null
  steps: ApprovalWorkflowStepRow[]
  decisions: ApprovalDecisionRow[]
}

export interface PaginatedApprovals {
  data: ApprovalWithDetails[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function getApprovals(
  status?: ApprovalStatus | 'all',
  opts?: { page?: number; pageSize?: number }
): Promise<PaginatedApprovals> {
  const supabase = await createClient()
  const pg = opts?.page ?? 1
  const size = opts?.pageSize ?? 50
  const from = (pg - 1) * size
  const to = from + size - 1

  let q = supabase
    .from('approvals')
    .select(
      `id, request_id, workflow_id, current_step, status, created_at, updated_at,
      request:requests (
        id, request_no, title, requester_id, priority, status, created_at,
        requester:profiles!requests_requester_id_fkey (id, full_name),
        service:services (id, name, icon),
        team:teams (id, name)
      ),
      workflow:approval_workflows (id, name)`,
      { count: 'exact' }
    )
    .order('updated_at', { ascending: false })

  if (status && status !== 'all') {
    q = q.eq('status', status)
  }

  q = q.range(from, to)

  const { data: approvals, count } = await q
  if (!approvals?.length) return { data: [], total: 0, page: pg, pageSize: size, totalPages: 0 }

  // Fetch steps and decisions for all approval IDs in parallel
  const ids = approvals.map((a) => a.id)

  const [{ data: steps }, { data: decisions }] = await Promise.all([
    supabase
      .from('approval_workflow_steps')
      .select('*, approver:profiles!approval_workflow_steps_approver_user_id_fkey (id, full_name)')
      .in('workflow_id', approvals.map((a) => a.workflow_id).filter(Boolean) as string[])
      .order('step_order', { ascending: true }),

    supabase
      .from('approval_decisions')
      .select('*, decider:profiles!approval_decisions_decided_by_fkey (id, full_name)')
      .in('approval_id', ids)
      .order('decided_at', { ascending: true }),
  ])

  const total = count ?? 0
  return {
    data: approvals.map((a) => ({
      ...a,
      request: a.request as ApprovalWithDetails['request'],
      workflow: a.workflow as ApprovalWithDetails['workflow'],
      steps: ((steps ?? []).filter((s) => s.workflow_id === a.workflow_id) as ApprovalWorkflowStepRow[]),
      decisions: ((decisions ?? []).filter((d) => d.approval_id === a.id) as ApprovalDecisionRow[]),
    })),
    total,
    page: pg,
    pageSize: size,
    totalPages: Math.ceil(total / size),
  }
}

export async function getApprovalsForRequest(requestId: string): Promise<ApprovalWithDetails[]> {
  // Use admin client so RLS never blocks approver names or step visibility
  const supabase = await createClient()
  const admin = createAdminClient() as unknown as typeof supabase

  const { data: approvals } = await supabase
    .from('approvals')
    .select(`
      id, request_id, workflow_id, current_step, status, created_at, updated_at,
      request:requests (
        id, request_no, title, requester_id, priority, status, created_at,
        requester:profiles!requests_requester_id_fkey (id, full_name),
        service:services (id, name, icon),
        team:teams (id, name)
      ),
      workflow:approval_workflows (id, name)
    `)
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })

  if (!approvals?.length) return []

  const workflowIds = [...new Set(approvals.map((a) => a.workflow_id).filter(Boolean))] as string[]
  const approvalIds = approvals.map((a) => a.id)

  const [{ data: steps }, { data: decisions }] = await Promise.all([
    admin
      .from('approval_workflow_steps')
      .select('*, approver:profiles!approval_workflow_steps_approver_user_id_fkey (id, full_name)')
      .in('workflow_id', workflowIds)
      .order('step_order', { ascending: true }),

    admin
      .from('approval_decisions')
      .select('*, decider:profiles!approval_decisions_decided_by_fkey (id, full_name)')
      .in('approval_id', approvalIds)
      .order('decided_at', { ascending: true }),
  ])

  return approvals.map((a) => ({
    ...a,
    request: a.request as ApprovalWithDetails['request'],
    workflow: a.workflow as ApprovalWithDetails['workflow'],
    steps: ((steps ?? []).filter((s) => s.workflow_id === a.workflow_id) as ApprovalWorkflowStepRow[]),
    decisions: ((decisions ?? []).filter((d) => d.approval_id === a.id) as ApprovalDecisionRow[]),
  }))
}

// Keep legacy single-record helper for places that only need the latest
export async function getApprovalForRequest(requestId: string): Promise<ApprovalWithDetails | null> {
  const all = await getApprovalsForRequest(requestId)
  return all[0] ?? null
}
