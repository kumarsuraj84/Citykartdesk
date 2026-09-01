import { createClient } from '@/lib/supabase/server'
import type {
  RequestWithRelations,
  RequestActivityWithActor,
  RequestCommentWithAuthor,
  RequestCollaborator,
  RequestStatus,
  RequestPriority,
} from '@/types'

export async function getRequestById(id: string): Promise<RequestWithRelations | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('requests')
    .select(`
      *,
      requester:profiles!requests_requester_id_fkey (*),
      assignee:profiles!requests_assigned_to_fkey (*),
      service:services (*),
      category:service_categories(id, name),
      sub_category:service_sub_categories(id, name),
      team:teams (*)
    `)
    .eq('id', id)
    .single()
  return data as RequestWithRelations | null
}

export type RequestPreviewSummary = {
  id: string
  request_no: string
  title: string
  description: string | null
  status: RequestStatus
  priority: RequestPriority
  created_at: string
  requester: { full_name: string } | null
  service: { name: string } | null
  category: { name: string } | null
  sub_category: { name: string } | null
}

// Lean counterpart to getRequestById() for read-only summary surfaces (the
// Approvals preview dialog / notification-bell preview) that only ever show
// these fields — getRequestById's `*` pulls form_data/form_schema_snapshot/
// form_sections_snapshot (JSONB, can be large) plus full nested profile/
// service/team rows, none of which the preview renders.
export async function getRequestPreviewSummary(id: string): Promise<RequestPreviewSummary | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('requests')
    .select(`
      id, request_no, title, description, status, priority, created_at,
      requester:profiles!requests_requester_id_fkey (full_name),
      service:services (name),
      category:service_categories (name),
      sub_category:service_sub_categories (name)
    `)
    .eq('id', id)
    .single()
  return data as RequestPreviewSummary | null
}

export async function getRequestActivity(requestId: string): Promise<RequestActivityWithActor[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('request_activity')
    .select(`*, actor:profiles (id, full_name)`)
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(100)
  return (data ?? []) as RequestActivityWithActor[]
}

export async function getRequestComments(requestId: string): Promise<RequestCommentWithAuthor[]> {
  const supabase = await createClient()
  // Latest-first: matches the conversation thread's display order. Also means the
  // 100-row cap keeps the newest activity on very long threads instead of stranding
  // it past the limit.
  const { data } = await supabase
    .from('request_comments')
    .select(`*, author:profiles (id, full_name)`)
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(100)
  return (data ?? []) as RequestCommentWithAuthor[]
}

export async function getRequestCollaborators(requestId: string): Promise<RequestCollaborator[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('request_collaborators')
    .select('id, user_id, added_by, added_at, profile:profiles!request_collaborators_user_id_fkey (id, full_name)')
    .eq('request_id', requestId)
    .order('added_at', { ascending: true })
  return (data ?? []) as RequestCollaborator[]
}

// ── getRequests ───────────────────────────────────────────────────────────────

// 'me'/'unassigned' are the two named states; any other value is a raw agent
// user id (the Team Queue "who's working this?" filter) — the `& {}` keeps
// the two literals autocompleting while still accepting an arbitrary string.
export type AssignedToFilter = 'me' | 'unassigned' | (string & {})

/** Standard user/agent views */
export type RequestView = 'mine' | 'queue' | 'collaborated'

/** Agent workbench views */
export type WorkbenchView =
  | 'assigned_me'
  | 'unassigned'
  | 'due_today'
  | 'overdue'
  | 'waiting_response'
  | 'recently_resolved'

export interface GetRequestsOptions {
  view: RequestView | WorkbenchView
  /** userId of the current viewer — avoids a redundant getUser() call */
  userId: string
  /** 'active' excludes closed/cancelled only (resolved still shows) — the
   *  existing default. 'unresolved' additionally excludes resolved — used by
   *  the "Requests by Technician" dashboard widget's Total column, which
   *  counts only the still-in-flight statuses (open/assigned/in_progress/
   *  waiting_user/pending_approval). */
  status?: RequestStatus | 'active' | 'unresolved'
  /** Matches title/request_no AND the body of any comment on the request (internal
   *  notes included — RLS on request_comments already hides those the viewer
   *  can't see, same as it would if they opened the thread directly). */
  q?: string
  limit?: number
  page?: number
  pageSize?: number
  /** Column filter: assignment state ('me'/'unassigned') or a specific agent id. */
  assignedTo?: AssignedToFilter
  /** Column filter: exact priority match. */
  priority?: RequestPriority
  /** Column filter: exact service match. */
  serviceId?: string
  /** Column filter: exact service-category match. */
  categoryId?: string
  /** Column filter: exact service-sub-category match. */
  subCategoryId?: string
  /** Agent-only: filter to show only requests from a specific requester */
  requesterId?: string
  sort?: string
  dir?: string
}

export interface PaginatedRequests {
  data: RequestWithRelations[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ── Workload metrics ──────────────────────────────────────────────────────────

export interface WorkloadMetrics {
  personal: {
    open: number
    overdue: number
    resolvedToday: number
    resolvedThisWeek: number
  }
  team: {
    open: number
    assigned: number
    unassigned: number
    overdue: number
  }
}

export async function getWorkloadMetrics(userId: string): Promise<WorkloadMetrics> {
  const supabase = await createClient()
  const now = new Date().toISOString()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 7)
  weekStart.setHours(0, 0, 0, 0)

  const ACTIVE = '("closed","cancelled")' as const

  const [
    { count: personalOpen },
    { count: personalOverdue },
    { count: resolvedToday },
    { count: resolvedThisWeek },
    { count: teamOpen },
    { count: teamAssigned },
    { count: teamUnassigned },
    { count: teamOverdue },
  ] = await Promise.all([
    // personal: assigned to me, active
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .eq('assigned_to', userId).not('status', 'in', ACTIVE),

    // personal: assigned to me, overdue (resolution past due, not terminal/resolved)
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .eq('assigned_to', userId).lt('resolution_due_at', now)
      .not('status', 'in', '("closed","cancelled","resolved")'),

    // personal: resolved today (use resolved_at for accuracy)
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .eq('assigned_to', userId).eq('status', 'resolved')
      .gte('resolved_at', todayStart.toISOString()),

    // personal: resolved this week
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .eq('assigned_to', userId).eq('status', 'resolved')
      .gte('resolved_at', weekStart.toISOString()),

    // team: all active (RLS scopes to team)
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .not('status', 'in', ACTIVE),

    // team: assigned, active
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .not('assigned_to', 'is', null).not('status', 'in', ACTIVE),

    // team: unassigned, open/in_progress/waiting_user
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .is('assigned_to', null).not('status', 'in', '("closed","cancelled","pending_approval","resolved")'),

    // team: overdue
    supabase.from('requests').select('*', { count: 'exact', head: true })
      .lt('resolution_due_at', now).not('status', 'in', '("closed","cancelled","resolved")'),
  ])

  return {
    personal: {
      open:              personalOpen   ?? 0,
      overdue:           personalOverdue ?? 0,
      resolvedToday:     resolvedToday  ?? 0,
      resolvedThisWeek:  resolvedThisWeek ?? 0,
    },
    team: {
      open:       teamOpen       ?? 0,
      assigned:   teamAssigned   ?? 0,
      unassigned: teamUnassigned ?? 0,
      overdue:    teamOverdue    ?? 0,
    },
  }
}

/**
 * Strip characters that break PostgREST .or() filter string parsing.
 * Commas split conditions; parentheses start/end grouped filters.
 * The percent sign is intentionally kept — it is a valid LIKE wildcard.
 */
function sanitizeQuery(q: string): string {
  return q.replace(/[(),]/g, '').trim()
}

// ── Requests by Technician (admin/manager home dashboard widget) ───────────────

/** The still-in-flight statuses a technician's workload is measured across —
 *  deliberately excludes resolved/closed/cancelled. */
export const ACTIVE_TECH_STATUSES: RequestStatus[] = ['open', 'assigned', 'in_progress', 'waiting_user', 'pending_approval']

export type TechnicianWorkloadRow = {
  /** null = the "Unassigned" row. */
  technicianId: string | null
  technicianName: string
  counts: Partial<Record<RequestStatus, number>>
  total: number
}

/**
 * One row per technician currently holding at least one active (non-resolved/
 * closed/cancelled) request, plus an "Unassigned" row, each broken down by
 * status. RLS scopes this to the viewer's org the same way getWorkloadMetrics()
 * above relies on it — no explicit org_id filter needed. Technicians with zero
 * active requests right now simply don't appear (matches the reference UI —
 * this is a workload snapshot, not a full roster).
 */
export async function getTechnicianWorkloadBoard(): Promise<TechnicianWorkloadRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('requests')
    .select('assigned_to, status')
    .in('status', ACTIVE_TECH_STATUSES)

  const rows = (data ?? []) as { assigned_to: string | null; status: RequestStatus }[]
  if (rows.length === 0) return []

  const byAssignee = new Map<string, Partial<Record<RequestStatus, number>>>()
  for (const r of rows) {
    const key = r.assigned_to ?? 'unassigned'
    const bucket = byAssignee.get(key) ?? {}
    bucket[r.status] = (bucket[r.status] ?? 0) + 1
    byAssignee.set(key, bucket)
  }

  const technicianIds = [...byAssignee.keys()].filter((k) => k !== 'unassigned')
  const { data: profiles } = technicianIds.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', technicianIds)
    : { data: [] as { id: string; full_name: string }[] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))

  const result: TechnicianWorkloadRow[] = [...byAssignee.entries()].map(([key, counts]) => ({
    technicianId: key === 'unassigned' ? null : key,
    technicianName: key === 'unassigned' ? 'Unassigned' : (nameById.get(key) ?? 'Unknown'),
    counts,
    total: Object.values(counts).reduce((sum: number, n) => sum + (n ?? 0), 0),
  }))

  // Busiest technician first; Unassigned always last regardless of count.
  result.sort((a, b) => {
    if (a.technicianId === null) return 1
    if (b.technicianId === null) return -1
    return b.total - a.total
  })

  return result
}

export async function getRequests(opts: GetRequestsOptions): Promise<PaginatedRequests> {
  const supabase = await createClient()
  const { userId, view, status, q, assignedTo, priority, serviceId, categoryId, subCategoryId, requesterId } = opts
  const pg = opts.page ?? 1
  const size = opts.pageSize ?? (opts.limit ?? 50)
  const from = (pg - 1) * size
  const to = from + size - 1

  // Explicit column list — excludes the heavy JSONB columns (form_data,
  // form_schema_snapshot, form_sections_snapshot) which the list never renders and are
  // only needed on the detail page (getRequestById). Avoids shipping 100KB+/page of
  // unused JSON.
  const selectCols = `
      id, request_no, title, description, requester_id, assigned_to, service_id, team_id,
      org_id, priority, status, response_due_at, resolution_due_at, responded_at,
      waiting_since, resolved_at, closed_at, created_at, updated_at, source_metadata,
      category_id, sub_category_id, reopen_count,
      requester:profiles!requests_requester_id_fkey (id, full_name, avatar_url),
      assignee:profiles!requests_assigned_to_fkey (id, full_name, avatar_url),
      service:services (id, name, icon, slug),
      category:service_categories (id, name),
      sub_category:service_sub_categories (id, name),
      team:teams (id, name)
    `

  let query = supabase
    .from('requests')
    .select(selectCols, { count: 'exact' })

  // ── View scoping ──────────────────────────────────────────────────────────

  const now = new Date().toISOString()

  // Sort headers in RequestsTable render on every view (mine/collaborated/queue
  // alike), so a user-selected sort must be honored here too — not just in the
  // queue branch's SLA-urgency default further down.
  const hasExplicitSort = Boolean(opts.sort) && opts.sort !== 'updated_at'
  const sortAsc = (opts.dir ?? 'desc') === 'asc'

  if (view === 'collaborated') {
    // Fetch request IDs where this user is an explicit collaborator
    const { data: collabRows } = await supabase
      .from('request_collaborators')
      .select('request_id')
      .eq('user_id', userId)
    const ids = (collabRows ?? []).map((r) => r.request_id)
    if (ids.length === 0) return { data: [], total: 0, page: pg, pageSize: size, totalPages: 0 }
    query = query.in('id', ids)
    query = hasExplicitSort
      ? query.order(opts.sort!, { ascending: sortAsc, nullsFirst: false })
      : query.order('updated_at', { ascending: sortAsc })
  } else if (view === 'mine') {
    // "My Requests" means exactly one thing: requests I raised as requester —
    // not requests I merely collaborate on (those live only in the dedicated
    // "Collaborated" tab) and not requests assigned to me as an agent (those
    // live in Team Queue, filterable to "Assigned to Me"). Mixing collaborated
    // tickets in here used to duplicate them across two tabs and blurred "I
    // raised this" with "I'm cc'd on this."
    query = query.eq('requester_id', userId)
    query = hasExplicitSort
      ? query.order(opts.sort!, { ascending: sortAsc, nullsFirst: false })
      : query.order('updated_at', { ascending: sortAsc })
  } else if (view === 'assigned_me') {
    query = query
      .eq('assigned_to', userId)
      .not('status', 'in', '("closed","cancelled")')
      .order('resolution_due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
  } else if (view === 'unassigned') {
    query = query
      .is('assigned_to', null)
      .not('status', 'in', '("closed","cancelled","pending_approval","resolved")')
      .order('resolution_due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
  } else if (view === 'due_today') {
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)
    query = query
      .gte('resolution_due_at', now)
      .lte('resolution_due_at', todayEnd.toISOString())
      .not('status', 'in', '("closed","cancelled","resolved")')
      .order('resolution_due_at', { ascending: true })
  } else if (view === 'overdue') {
    query = query
      .lt('resolution_due_at', now)
      .not('status', 'in', '("closed","cancelled","resolved")')
      .order('resolution_due_at', { ascending: true })
  } else if (view === 'waiting_response') {
    query = query
      .eq('status', 'waiting_user')
      .order('updated_at', { ascending: true })
  } else if (view === 'recently_resolved') {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    query = query
      .eq('status', 'resolved')
      .gte('resolved_at', weekAgo.toISOString())
      .order('resolved_at', { ascending: false })
  } else {
    // Queue view: team work (RLS scopes to team). Exclude own non-intake
    // submissions, but intake-converted requests (where the approver becomes
    // requester_id) must still appear — they're team work, not self-service.
    const { data: intakeByMe } = await supabase
      .from('requests')
      .select('id')
      .eq('requester_id', userId)
      .filter('source_metadata', 'cs', '{"created_via":"intake"}')
    const intakeByMeIds = (intakeByMe ?? []).map((r) => (r as { id: string }).id)

    if (intakeByMeIds.length > 0) {
      query = query.or(`requester_id.neq.${userId},id.in.(${intakeByMeIds.join(',')})`)
    } else {
      query = query.neq('requester_id', userId)
    }

    // Also exclude anything the user collaborates on — collaborated requests
    // belong in the dedicated "Collaborated" tab only, kept as a distinct facet
    // from "raised by me" (My Requests) and "my team's work" (Team Queue) so no
    // ticket is duplicated across tabs.
    const { data: collabRows } = await supabase
      .from('request_collaborators')
      .select('request_id')
      .eq('user_id', userId)
    const collabIds = (collabRows ?? []).map((r) => r.request_id)
    if (collabIds.length > 0) {
      query = query.not('id', 'in', `(${collabIds.join(',')})`)
    }
    // Sort: user-selected or default SLA urgency
    if (opts.sort && opts.sort !== 'updated_at') {
      const asc = (opts.dir ?? 'desc') === 'asc'
      query = query.order(opts.sort, { ascending: asc, nullsFirst: false })
    } else if (opts.sort === 'updated_at') {
      query = query.order('updated_at', { ascending: (opts.dir ?? 'desc') === 'asc' })
    } else {
      query = query
        .order('resolution_due_at', { ascending: true, nullsFirst: false })
        .order('response_due_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
    }
  }

  // ── Status filter ─────────────────────────────────────────────────────────

  if (status === 'active') {
    query = query.not('status', 'in', '("closed","cancelled")')
  } else if (status === 'unresolved') {
    query = query.not('status', 'in', '("resolved","closed","cancelled")')
  } else if (status) {
    query = query.eq('status', status)
  }

  // ── Assignee column filter — works on any view, not just queue, now that
  // both My Requests and Team Queue render through the same table/Assignee column.

  if (assignedTo === 'unassigned') {
    query = query.is('assigned_to', null)
  } else if (assignedTo === 'me') {
    query = query.eq('assigned_to', userId)
  } else if (assignedTo) {
    query = query.eq('assigned_to', assignedTo)
  }

  // ── Priority / Service column filters ─────────────────────────────────────

  if (priority) query = query.eq('priority', priority)
  if (serviceId) query = query.eq('service_id', serviceId)
  if (categoryId) query = query.eq('category_id', categoryId)
  if (subCategoryId) query = query.eq('sub_category_id', subCategoryId)

  // ── Requester filter (agent viewing specific user's history) ─────────────

  if (requesterId) {
    query = query.eq('requester_id', requesterId)
  }

  // ── Search — title/request_no, plus (global) any comment on the request,
  // internal notes included (RLS on request_comments already scopes what a
  // given viewer can see, same as opening the thread itself would). ─────────

  if (q) {
    const safe = sanitizeQuery(q)
    if (safe.length > 0) {
      const { data: commentMatches } = await supabase
        .from('request_comments')
        .select('request_id')
        .ilike('body', `%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(500)
      const commentRequestIds = Array.from(new Set((commentMatches ?? []).map((r) => r.request_id)))
      const orParts = [`title.ilike.%${safe}%`, `request_no.ilike.%${safe}%`]
      if (commentRequestIds.length > 0) orParts.push(`id.in.(${commentRequestIds.join(',')})`)
      query = query.or(orParts.join(','))
    }
  }

  // Apply range for pagination
  query = query.range(from, to)

  const { data, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / size)
  return {
    data: (data ?? []) as RequestWithRelations[],
    total,
    page: pg,
    pageSize: size,
    totalPages,
  }
}


export async function getRelatedRequests(requestId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('related_requests')
    .select(`
      id,
      link_type,
      created_by,
      request_id,
      related_id,
      source:requests!related_requests_request_id_fkey (id, request_no, title, status, priority),
      target:requests!related_requests_related_id_fkey (id, request_no, title, status, priority)
    `)
    .or(`request_id.eq.${requestId},related_id.eq.${requestId}`)
    .order('created_at')

  if (!data) return []

  // Normalise: always surface the "other" side relative to requestId
  return data.map((row: {
    id: string
    link_type: string
    created_by: string
    request_id: string
    related_id: string
    source: { id: string; request_no: string; title: string; status: string; priority: string } | null
    target: { id: string; request_no: string; title: string; status: string; priority: string } | null
  }) => {
    const other = row.request_id === requestId ? row.target : row.source
    return {
      link_id: row.id,
      link_type: row.link_type,
      created_by: row.created_by,
      id: other?.id ?? '',
      request_no: other?.request_no ?? '',
      title: other?.title ?? '',
      status: other?.status ?? '',
      priority: other?.priority ?? '',
    }
  })
}

export async function getRequestsForProject(projectId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('requests')
    .select('id, request_no, title, status, priority, updated_at, assignee:profiles!requests_assigned_to_fkey (id, full_name)')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  return data ?? []
}

export async function getCsatSurveyForRequest(requestId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('csat_surveys')
    .select('id, rating, comment, submitted_at')
    .eq('request_id', requestId)
    .maybeSingle()
  return data ?? null
}
