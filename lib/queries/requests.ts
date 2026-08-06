import { createClient } from '@/lib/supabase/server'
import type {
  RequestWithRelations,
  RequestActivityWithActor,
  RequestCommentWithAuthor,
  RequestCollaborator,
  RequestStatus,
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
      team:teams (*)
    `)
    .eq('id', id)
    .single()
  return data as RequestWithRelations | null
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
  const { data } = await supabase
    .from('request_comments')
    .select(`*, author:profiles (id, full_name)`)
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
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

export type AssignedToFilter = 'me' | 'unassigned'

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
  status?: RequestStatus | 'active'
  q?: string
  limit?: number
  page?: number
  pageSize?: number
  /** Queue-only: filter by assignment state */
  assignedTo?: AssignedToFilter
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

export async function getRequests(opts: GetRequestsOptions): Promise<PaginatedRequests> {
  const supabase = await createClient()
  const { userId, view, status, q, assignedTo, requesterId } = opts
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
      requester:profiles!requests_requester_id_fkey (id, full_name, avatar_url),
      assignee:profiles!requests_assigned_to_fkey (id, full_name, avatar_url),
      service:services (id, name, icon, slug),
      team:teams (id, name)
    `

  let query = supabase
    .from('requests')
    .select(selectCols, { count: 'exact' })

  // ── View scoping ──────────────────────────────────────────────────────────

  const now = new Date().toISOString()

  if (view === 'collaborated') {
    // Fetch request IDs where this user is an explicit collaborator
    const { data: collabRows } = await supabase
      .from('request_collaborators')
      .select('request_id')
      .eq('user_id', userId)
    const ids = (collabRows ?? []).map((r) => r.request_id)
    if (ids.length === 0) return { data: [], total: 0, page: pg, pageSize: size, totalPages: 0 }
    query = query
      .in('id', ids)
      .order('updated_at', { ascending: false })
  } else if (view === 'mine') {
    query = query
      .eq('requester_id', userId)
      .order('updated_at', { ascending: false })
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
  } else if (status) {
    query = query.eq('status', status)
  }

  // ── Assignment filter (queue only) ────────────────────────────────────────

  if (view === 'queue' && assignedTo === 'unassigned') {
    query = query.is('assigned_to', null)
  } else if (view === 'queue' && assignedTo === 'me') {
    query = query.eq('assigned_to', userId)
  }

  // ── Requester filter (agent viewing specific user's history) ─────────────

  if (requesterId) {
    query = query.eq('requester_id', requesterId)
  }

  // ── Search ────────────────────────────────────────────────────────────────

  if (q) {
    const safe = sanitizeQuery(q)
    if (safe.length > 0) {
      query = query.or(`title.ilike.%${safe}%,request_no.ilike.%${safe}%`)
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

export async function getCsatSurveyForRequest(requestId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('csat_surveys')
    .select('id, rating, comment, submitted_at')
    .eq('request_id', requestId)
    .maybeSingle()
  return data ?? null
}
