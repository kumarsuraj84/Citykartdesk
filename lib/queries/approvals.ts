import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ApprovalStatus, RequestPriority, RequestStatus } from '@/types'
import type { Tables } from '@/types/database'
import { approvalPeopleLine } from '@/lib/approvals/people'
import { inBatches } from '@/lib/queries/in-batches'

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
  /** the number on each tab, when the list was narrowed to one person's view (see restrictTo) */
  counts?: Record<string, number>
}

/** A manager's view of the Approvals page: approvals sent to them, on their own requests, and on their team's requests. */
export interface ApprovalsRestriction { userId: string; teamIds: string[] }

/** The approvals one person may see in the list: sent to them (named, or "any manager"), raised by them, or on their team's requests. */
async function visibleApprovalMeta(supabase: Awaited<ReturnType<typeof createClient>>, who: ApprovalsRestriction) {
  type Meta = { id: string; status: ApprovalStatus; updated_at: string }
  const out = new Map<string, Meta>()
  const add = (rows: Meta[] | null) => { for (const r of rows ?? []) out.set(r.id, r) }

  const { data: steps } = await supabase
    .from('approval_workflow_steps')
    .select('workflow_id')
    .or(`approver_user_id.eq.${who.userId},approver_type.eq.any_manager`)
  const workflowIds = [...new Set((steps ?? []).map((s: { workflow_id: string }) => s.workflow_id))]

  const [mine, team, sent] = await Promise.all([
    supabase.from('approvals').select('id, status, updated_at, request:requests!inner(requester_id)').eq('request.requester_id', who.userId),
    who.teamIds.length > 0
      ? supabase.from('approvals').select('id, status, updated_at, request:requests!inner(team_id)').in('request.team_id', who.teamIds)
      : Promise.resolve({ data: [] as Meta[] }),
    workflowIds.length > 0
      ? supabase.from('approvals').select('id, status, updated_at').in('workflow_id', workflowIds)
      : Promise.resolve({ data: [] as Meta[] }),
  ])
  add(mine.data as unknown as Meta[]); add(team.data as unknown as Meta[]); add(sent.data as unknown as Meta[])
  return [...out.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export async function getApprovals(
  status?: ApprovalStatus | 'all',
  opts?: { page?: number; pageSize?: number; restrictTo?: ApprovalsRestriction }
): Promise<PaginatedApprovals> {
  const supabase = await createClient()
  const pg = opts?.page ?? 1
  const size = opts?.pageSize ?? 50
  const from = (pg - 1) * size
  const to = from + size - 1

  // A narrowed view (a manager): work out which approvals are theirs first, then load only the page being shown.
  let pageIds: string[] | null = null
  let scopedTotal = 0
  let counts: Record<string, number> | undefined
  if (opts?.restrictTo) {
    const meta = await visibleApprovalMeta(supabase, opts.restrictTo)
    counts = { pending: 0, approved: 0, rejected: 0, all: meta.length }
    for (const m of meta) if (m.status in counts) counts[m.status]++
    const wanted = meta.filter((m) => !status || status === 'all' || m.status === status)
    scopedTotal = wanted.length
    pageIds = wanted.slice(from, to + 1).map((m) => m.id)
    if (pageIds.length === 0) return { data: [], total: scopedTotal, page: pg, pageSize: size, totalPages: Math.ceil(scopedTotal / size), counts }
  }

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

  if (pageIds) {
    q = q.in('id', pageIds)
  } else {
    if (status && status !== 'all') q = q.eq('status', status)
    q = q.range(from, to)
  }

  const { data: approvals, count } = await q
  if (!approvals?.length) return { data: [], total: scopedTotal, page: pg, pageSize: size, totalPages: Math.ceil(scopedTotal / size), counts }

  // Fetch steps and decisions for all approval IDs in parallel
  const ids = approvals.map((a) => a.id)

  // (the approver and decider NAMES are read with the admin client so a technician sees who it is with / who decided too, exactly as
  // getApprovalsForRequest does; only the approvals the viewer's own row rules returned above are looked up)
  const nameReader = createAdminClient() as unknown as typeof supabase
  const [{ data: steps }, { data: decisions }] = await Promise.all([
    nameReader
      .from('approval_workflow_steps')
      .select('*, approver:profiles!approval_workflow_steps_approver_user_id_fkey (id, full_name)')
      .in('workflow_id', approvals.map((a) => a.workflow_id).filter(Boolean) as string[])
      .order('step_order', { ascending: true }),

    nameReader
      .from('approval_decisions')
      .select('*, decider:profiles!approval_decisions_decided_by_fkey (id, full_name)')
      .in('approval_id', ids)
      .order('decided_at', { ascending: true }),
  ])

  const total = pageIds ? scopedTotal : (count ?? 0)
  return {
    counts,
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
    inBatches(workflowIds, (batch) => admin
      .from('approval_workflow_steps')
      .select('*, approver:profiles!approval_workflow_steps_approver_user_id_fkey (id, full_name)')
      .in('workflow_id', batch)
      .order('step_order', { ascending: true })),

    inBatches(approvalIds, (batch) => admin
      .from('approval_decisions')
      .select('*, decider:profiles!approval_decisions_decided_by_fkey (id, full_name)')
      .in('approval_id', batch)
      .order('decided_at', { ascending: true })),
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

// ── What is waiting for one person ─────────────────────────────────────────────

export interface PendingApprovalItem {
  approvalId: string
  requestId: string
  requestNo: string
  requestTitle: string
  requesterName: string
  /** who sent it for approval (a technician, or the requester themselves) */
  sentByName: string
  /** who it is waiting on, by name ("Awaiting: A and B") */
  awaiting: string
  createdAt: string
}

/**
 * The approvals that are waiting for this person to decide RIGHT NOW: still pending, on a request that is still open, and either
 * their own undecided step of a parallel approval, or the current step of a step-by-step one (an "any manager" step counts for
 * managers). This one list feeds the Approvals badge, the sidebar number and the bell, so they can never disagree, and it does
 * not depend on how many other notifications have arrived since.
 */
export const getActionableApprovalsForUser = cache(async function (userId: string, role: string, orgId: string): Promise<PendingApprovalItem[]> {
  const admin = createAdminClient()
  const isManager = role === 'manager' || role === 'admin' || role === 'platform_owner'

  const { data: steps } = await admin
    .from('approval_workflow_steps')
    .select('workflow_id, step_order, approver_type, approver_user_id')
    .or(isManager ? `approver_user_id.eq.${userId},approver_type.eq.any_manager` : `approver_user_id.eq.${userId}`)
  const mySteps = (steps ?? []) as { workflow_id: string; step_order: number; approver_type: string; approver_user_id: string | null }[]
  const workflowIds = [...new Set(mySteps.map((s) => s.workflow_id))]
  if (workflowIds.length === 0) return []

  // scoped to the person's own organisation (the admin client bypasses row rules, so this is the boundary)
  const { data: approvals } = await admin
    .from('approvals')
    .select('id, request_id, workflow_id, current_step, created_at, requested_by, request:requests!inner(request_no, title, status, org_id, requester:profiles!requests_requester_id_fkey(full_name))')
    .eq('status', 'pending')
    .in('workflow_id', workflowIds)
    .eq('request.org_id', orgId)
  type Row = { id: string; request_id: string; workflow_id: string; current_step: number | null; created_at: string; requested_by: string | null; request: { request_no: string; title: string; status: string; requester: { full_name: string } | { full_name: string }[] | null } | { request_no: string; title: string; status: string; requester: { full_name: string } | { full_name: string }[] | null }[] }
  const rows = ((approvals ?? []) as unknown as Row[])
  if (rows.length === 0) return []

  const { data: decisions } = await inBatches(rows.map((r) => r.id), (batch) => admin.from('approval_decisions').select('approval_id, step_order').in('approval_id', batch))
  const decided = new Map<string, Set<number>>()
  for (const d of (decisions ?? []) as { approval_id: string; step_order: number }[]) {
    const set = decided.get(d.approval_id) ?? new Set<number>()
    set.add(d.step_order)
    decided.set(d.approval_id, set)
  }

  const mine = (s: { approver_type: string; approver_user_id: string | null }) =>
    s.approver_user_id === userId || (s.approver_type === 'any_manager' && isManager)

  const actionable = rows.filter((r) => {
    const req = Array.isArray(r.request) ? r.request[0] : r.request
    if (!req || req.status === 'cancelled' || req.status === 'closed') return false
    const here = mySteps.filter((s) => s.workflow_id === r.workflow_id && mine(s))
    if (r.current_step === 0) return here.some((s) => s.approver_type === 'specific_user' && !(decided.get(r.id)?.has(s.step_order)))
    return here.some((s) => s.step_order === (r.current_step ?? 1))
  })
  if (actionable.length === 0) return []

  // everyone each approval is with, by name, for the "Awaiting: ..." line
  const [{ data: allSteps }, { data: allDecisions }] = await Promise.all([
    inBatches(actionable.map((r) => r.workflow_id), (batch) => admin.from('approval_workflow_steps').select('*, approver:profiles!approval_workflow_steps_approver_user_id_fkey (id, full_name)').in('workflow_id', batch)),
    inBatches(actionable.map((r) => r.id), (batch) => admin.from('approval_decisions').select('*, decider:profiles!approval_decisions_decided_by_fkey (id, full_name)').in('approval_id', batch)),
  ])

  const senderIds = [...new Set(actionable.map((r) => r.requested_by).filter((v): v is string => !!v))]
  const { data: senders } = await inBatches<{ id: string; full_name: string }>(senderIds, (batch) => admin.from('profiles').select('id, full_name').in('id', batch))
  const nameById = new Map((senders ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]))

  return actionable
    .map((r): PendingApprovalItem => {
      const req = Array.isArray(r.request) ? r.request[0] : r.request
      const who = Array.isArray(req.requester) ? req.requester[0] : req.requester
      return {
        approvalId: r.id, requestId: r.request_id, requestNo: req.request_no, requestTitle: req.title,
        requesterName: who?.full_name ?? '', sentByName: (r.requested_by ? nameById.get(r.requested_by) : '') || who?.full_name || '', createdAt: r.created_at,
        awaiting: approvalPeopleLine({
          status: 'pending', current_step: r.current_step,
          steps: ((allSteps ?? []) as unknown as ApprovalWorkflowStepRow[]).filter((s) => s.workflow_id === r.workflow_id),
          decisions: ((allDecisions ?? []) as unknown as ApprovalDecisionRow[]).filter((d) => d.approval_id === r.id),
        }).text,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
})
