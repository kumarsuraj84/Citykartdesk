import { createClient } from '@/lib/supabase/server'

// Intake Intelligence — Phase A read queries.
// All RLS-respecting (user-session client); org isolation enforced by RLS.

// Intake tables (intake_*) are not yet in the generated types/database.ts snapshot.
// Use AnyClient to unblock TypeScript until the snapshot is regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args?: any) => any }

export type IntakeChannel = {
  id: string
  org_id: string
  type: 'email' | 'portal' | 'whatsapp' | 'teams' | 'slack' | 'api'
  name: string
  provider: string | null
  config: Record<string, unknown>
  status: 'active' | 'paused' | 'error'
  last_polled_at: string | null
  last_error: string | null
  default_team_id: string | null
  created_at: string
}

export type IntakeQueueItem = {
  id: string
  subject: string | null
  from_address: string | null
  status: string
  received_at: string | null
  created_at: string
  channel: { name: string; type: string } | null
}

export type IntakeDashboardStats = {
  newCount: number
  inReviewCount: number
  actionedCount: number
  channelCount: number
  activeChannelCount: number
}

// ── Dashboard KPIs ──────────────────────────────────────────────────────────
// Counts via indexed predicates (head:true), no count:'exact' on hot lists.
export async function getIntakeDashboardStats(): Promise<IntakeDashboardStats> {
  const supabase = (await createClient()) as unknown as AnyClient

  const [newRes, reviewRes, actionedRes, channelRes, activeChannelRes] = await Promise.all([
    supabase.from('intake_messages').select('*', { count: 'estimated', head: true }).eq('status', 'new'),
    // Open reviews awaiting a human — counted from the review state machine, not
    // message.status (the pipeline leaves messages 'classified', so a status
    // count read ~0 even with a full queue). pending + in_review = the worklist.
    supabase.from('intake_reviews').select('*', { count: 'estimated', head: true }).in('state', ['pending', 'in_review']),
    supabase.from('intake_messages').select('*', { count: 'estimated', head: true }).eq('status', 'actioned'),
    supabase.from('intake_channels').select('*', { count: 'estimated', head: true }),
    supabase.from('intake_channels').select('*', { count: 'estimated', head: true }).eq('status', 'active'),
  ])

  return {
    newCount:          newRes.count ?? 0,
    inReviewCount:     reviewRes.count ?? 0,
    actionedCount:     actionedRes.count ?? 0,
    channelCount:      channelRes.count ?? 0,
    activeChannelCount: activeChannelRes.count ?? 0,
  }
}

// ── Triage queue ────────────────────────────────────────────────────────────
export async function getIntakeQueue(opts: {
  status?: string
  channelId?: string
  page?: number
  pageSize?: number
} = {}): Promise<{ data: IntakeQueueItem[]; page: number; pageSize: number }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = opts.pageSize ?? 50
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('intake_messages')
    .select('id, subject, from_address, status, received_at, created_at, channel:intake_channels (name, type)')
    .order('received_at', { ascending: false, nullsFirst: false })
    .range(from, to)

  if (opts.status)    query = query.eq('status', opts.status)
  if (opts.channelId) query = query.eq('channel_id', opts.channelId)

  const { data } = await query
  return { data: (data ?? []) as unknown as IntakeQueueItem[], page, pageSize }
}

// ── Channels ────────────────────────────────────────────────────────────────
export async function getIntakeChannels(): Promise<IntakeChannel[]> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase
    .from('intake_channels')
    .select('id, org_id, type, name, provider, config, status, last_polled_at, last_error, default_team_id, created_at')
    .order('created_at', { ascending: false })
  return (data ?? []) as unknown as IntakeChannel[]
}

// ── Review Center (Phase C) ──────────────────────────────────────────────────

export type WorkType = 'request' | 'task' | 'approval' | 'ignore'
export type IntakePriority = 'low' | 'medium' | 'high' | 'urgent'
export type ReviewState = 'pending' | 'in_review' | 'approved' | 'rejected' | 'converted'

export type IntakeReviewQueueItem = {
  id: string
  message_id: string
  state: ReviewState
  suggested_type: WorkType | null
  suggested_department: string | null
  suggested_category: string | null
  suggested_priority: IntakePriority | null
  suggested_confidence: number | null
  final_type: WorkType | null
  final_priority: IntakePriority | null
  created_at: string
  stage: string | null
  provider: string | null
  message: { subject: string | null; from_address: string | null; channel: { name: string } | null } | null
}

// Queue is driven by intake_reviews (which carries the snapshotted suggestions),
// joined to the message for subject/sender. Estimated counts only — no exact count.
export async function getIntakeReviewQueue(opts: {
  state?: string
  type?: string
  department?: string
  priority?: string
  page?: number
  pageSize?: number
} = {}): Promise<{ data: IntakeReviewQueueItem[]; page: number; pageSize: number }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = opts.pageSize ?? 50
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('intake_reviews')
    .select(`
      id, message_id, state,
      suggested_type, suggested_department, suggested_category, suggested_priority, suggested_confidence,
      final_type, final_priority, created_at,
      classification:intake_classifications!classification_id ( stage, provider ),
      message:intake_messages!inner ( subject, from_address, channel:intake_channels ( name ) )
    `)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (opts.state)      query = query.eq('state', opts.state)
  if (opts.type)       query = query.eq('suggested_type', opts.type)
  if (opts.department) query = query.eq('suggested_department', opts.department)
  if (opts.priority)   query = query.eq('suggested_priority', opts.priority)

  const { data, error } = await query
  if (error) {
    // Don't fail silently with an empty queue — surface the cause (usual suspect:
    // the Phase D migration or the classification embed relationship).
    console.error('[getIntakeReviewQueue] query failed:', error.message)
    return { data: [], page, pageSize }
  }
  // Flatten the classification embed (PostgREST may return it as an array).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalised = (data ?? []).map((r: any) => {
    const cls = Array.isArray(r.classification) ? r.classification[0] : r.classification
    return { ...r, stage: cls?.stage ?? null, provider: cls?.provider ?? null }
  })
  return { data: normalised as unknown as IntakeReviewQueueItem[], page, pageSize }
}

export type IntakeReviewDetail = {
  id: string
  message_id: string
  thread_id: string | null
  state: ReviewState
  assigned_reviewer_id: string | null
  suggested_type: WorkType | null
  suggested_department: string | null
  suggested_category: string | null
  suggested_subcategory: string | null
  suggested_priority: IntakePriority | null
  suggested_confidence: number | null
  suggested_service_id: string | null
  suggested_category_id: string | null
  suggested_team_id: string | null
  final_type: WorkType | null
  final_department: string | null
  final_category: string | null
  final_subcategory: string | null
  final_priority: IntakePriority | null
  was_overridden: boolean
  decision_notes: string | null
  is_starred: boolean
  is_escalated: boolean
  escalation_note: string | null
  message: {
    id: string
    subject: string | null
    from_address: string | null
    to_addresses: string[] | null
    cc_addresses: string[] | null
    body_text: string | null
    body_html: string | null
    received_at: string | null
    thread_id: string | null
    channel: { name: string; type: string; default_team_id: string | null } | null
  } | null
  classification: { rationale: string | null; confidence: number; provider: string; stage: string } | null
  // Phase D: set once work is created
  created_request_id: string | null
  created_task_id: string | null
  created_approval_id: string | null
}

export async function getIntakeReview(id: string): Promise<{
  review: IntakeReviewDetail | null
  attachments: { id: string; file_name: string; file_size: number; mime_type: string | null; storage_path: string }[]
  thread: { id: string; subject: string | null; from_address: string | null; received_at: string | null }[]
}> {
  const supabase = (await createClient()) as unknown as AnyClient

  const { data: review } = await supabase
    .from('intake_reviews')
    .select(`
      id, message_id, thread_id, state, assigned_reviewer_id,
      suggested_type, suggested_department, suggested_category, suggested_subcategory, suggested_priority, suggested_confidence,
      suggested_service_id, suggested_category_id, suggested_team_id,
      final_type, final_department, final_category, final_subcategory, final_priority, was_overridden, decision_notes,
      is_starred, is_escalated, escalation_note,
      created_request_id, created_task_id, created_approval_id,
      message:intake_messages!inner (
        id, subject, from_address, to_addresses, cc_addresses, body_text, body_html, received_at, thread_id,
        channel:intake_channels ( name, type, default_team_id )
      ),
      classification:intake_classifications ( rationale, confidence, provider, stage )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!review) return { review: null, attachments: [], thread: [] }

  const messageId = (review as { message_id: string }).message_id
  const threadId = (review as { thread_id: string | null }).thread_id

  const [{ data: attachments }, { data: thread }] = await Promise.all([
    supabase
      .from('intake_attachments')
      .select('id, file_name, file_size, mime_type, storage_path')
      .eq('message_id', messageId),
    threadId
      ? supabase
          .from('intake_messages')
          .select('id, subject, from_address, received_at')
          .eq('thread_id', threadId)
          .order('received_at', { ascending: true })
      : Promise.resolve({ data: [] }),
  ])

  // classification join may return an array — normalise to the final one.
  const rawClass = (review as unknown as { classification: unknown }).classification
  const classification = Array.isArray(rawClass) ? rawClass[0] ?? null : rawClass ?? null

  return {
    review: { ...(review as unknown as IntakeReviewDetail), classification },
    attachments: (attachments ?? []) as never,
    thread: (thread ?? []) as never,
  }
}

// ── Classification Validation Stats (Phase C validation pass) ─────────────────

export type IntakeValidationStats = {
  total: number
  totalMessages: number
  byType: Record<string, number>
  byDepartment: Record<string, number>
  byConfidence: { low: number; medium: number; good: number; high: number }
  reviewed: number
  overrides: number
  overrideRate: number
  byStage: {
    stage: string
    provider: string | null
    total: number
    reviewed: number
    overrides: number
    overrideRate: number
    avgConfidence: number
    totalCostMicrocents: number
  }[]
  sampleLow: {
    id: string
    message_id: string
    subject: string | null
    from_address: string | null
    suggested_type: string | null
    suggested_department: string | null
    suggested_confidence: number | null
  }[]
}

export async function getIntakeValidationStats(): Promise<IntakeValidationStats> {
  // P2: the DB aggregates and returns a single JSONB summary (see migration
  // 20240101000063) instead of shipping every review row to JS. Tenant scoping is
  // handled inside the function via current_org_id() + RLS.
  const supabase = (await createClient()) as unknown as AnyClient
  const empty: IntakeValidationStats = {
    total: 0, totalMessages: 0, byType: {}, byDepartment: {},
    byConfidence: { low: 0, medium: 0, good: 0, high: 0 },
    reviewed: 0, overrides: 0, overrideRate: 0, byStage: [], sampleLow: [],
  }

  const { data, error } = await supabase.rpc('intake_validation_stats')
  if (error || !data) {
    // The RPC migration (063) may not be applied yet — don't blank the
    // dashboard. Fall back to aggregating the rows in JS so stats still render.
    console.warn('[getIntakeValidationStats] rpc unavailable, falling back to JS aggregation:', error?.message)
    return aggregateValidationStatsInJs(supabase, empty)
  }
  // The function returns the exact IntakeValidationStats shape as JSONB.
  return { ...empty, ...(data as Partial<IntakeValidationStats>) }
}

// Fallback aggregation when the intake_validation_stats() RPC isn't present.
// Mirrors the function's logic in JS. Heavier (transfers rows) but correct, and
// only runs until the migration is applied.
async function aggregateValidationStatsInJs(
  supabase: AnyClient,
  empty: IntakeValidationStats,
): Promise<IntakeValidationStats> {
  const [{ data: reviews, error: rErr }, { count: msgCount }] = await Promise.all([
    supabase
      .from('intake_reviews')
      .select(`
        id, message_id, suggested_type, suggested_department, suggested_confidence, was_overridden, state,
        classification:intake_classifications!classification_id ( stage, provider, cost_microcents ),
        message:intake_messages!inner ( subject, from_address )
      `),
    supabase.from('intake_messages').select('*', { count: 'estimated', head: true }),
  ])
  if (rErr || !reviews) {
    console.error('[getIntakeValidationStats] JS fallback failed:', rErr?.message)
    return empty
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (reviews as any[]).map((r) => {
    const cls = Array.isArray(r.classification) ? r.classification[0] : r.classification
    const msg = Array.isArray(r.message) ? r.message[0] : r.message
    const reviewed = r.state !== 'pending' && r.state !== 'in_review'
    return {
      id: r.id, message_id: r.message_id,
      suggested_type: r.suggested_type as string | null,
      suggested_department: r.suggested_department as string | null,
      conf: r.suggested_confidence ?? 0,
      suggested_confidence: r.suggested_confidence as number | null,
      was_overridden: Boolean(r.was_overridden),
      reviewed,
      stage: cls?.stage ?? 'unknown',
      provider: cls?.provider ?? null,
      cost: cls?.cost_microcents ?? 0,
      subject: msg?.subject ?? null,
      from_address: msg?.from_address ?? null,
    }
  })

  const byType: Record<string, number> = {}
  const byDepartment: Record<string, number> = {}
  const byConfidence = { low: 0, medium: 0, good: 0, high: 0 }
  const stageMap = new Map<string, { provider: string | null; total: number; reviewed: number; overrides: number; confSum: number; cost: number }>()

  let reviewedCount = 0
  let overrides = 0
  for (const r of rows) {
    if (r.suggested_type) byType[r.suggested_type] = (byType[r.suggested_type] ?? 0) + 1
    if (r.suggested_department) byDepartment[r.suggested_department] = (byDepartment[r.suggested_department] ?? 0) + 1
    if (r.conf < 40) byConfidence.low++
    else if (r.conf < 70) byConfidence.medium++
    else if (r.conf < 90) byConfidence.good++
    else byConfidence.high++
    if (r.reviewed) { reviewedCount++; if (r.was_overridden) overrides++ }

    const s = stageMap.get(r.stage) ?? { provider: r.provider, total: 0, reviewed: 0, overrides: 0, confSum: 0, cost: 0 }
    s.total++
    s.confSum += r.conf
    s.cost += r.cost
    if (r.reviewed) { s.reviewed++; if (r.was_overridden) s.overrides++ }
    stageMap.set(r.stage, s)
  }

  const byStage = [...stageMap.entries()].map(([stage, s]) => ({
    stage, provider: s.provider, total: s.total, reviewed: s.reviewed, overrides: s.overrides,
    overrideRate: s.reviewed > 0 ? Math.round((s.overrides / s.reviewed) * 100) : 0,
    avgConfidence: s.total > 0 ? Math.round(s.confSum / s.total) : 0,
    totalCostMicrocents: Math.round(s.cost),
  })).sort((a, b) => b.total - a.total)

  const sampleLow = rows
    .filter((r) => r.conf < 40)
    .sort((a, b) => (a.suggested_confidence ?? 0) - (b.suggested_confidence ?? 0))
    .slice(0, 5)
    .map((r) => ({
      id: r.id, message_id: r.message_id, subject: r.subject, from_address: r.from_address,
      suggested_type: r.suggested_type, suggested_department: r.suggested_department,
      suggested_confidence: r.suggested_confidence,
    }))

  return {
    total: rows.length,
    totalMessages: msgCount ?? 0,
    byType, byDepartment, byConfidence,
    reviewed: reviewedCount,
    overrides,
    overrideRate: reviewedCount > 0 ? Math.round((overrides / reviewedCount) * 100) : 0,
    byStage,
    sampleLow,
  }
}

// ── Inbox queries (Phase D+) ───────────────────────────────────────────────

export type InboxMessage = {
  id: string
  subject: string | null
  from_address: string | null
  to_addresses: string[] | null
  received_at: string | null
  snippet: string | null
  status: string
  is_read: boolean
  is_archived: boolean
  thread_id: string | null
  recipient_type: 'to' | 'cc' | 'bcc'
  channel: { id: string; name: string; type: string } | null
  review: {
    id: string
    state: string
    suggested_type: string | null
    suggested_department: string | null
    suggested_priority: string | null
    suggested_confidence: number | null
    is_starred: boolean
    is_escalated: boolean
    escalation_note: string | null
    created_request_id: string | null
    created_task_id: string | null
    stage: string | null
    provider: string | null
  } | null
}

export async function getInboxMessages(opts: {
  archived?: boolean   // omit to fetch BOTH (the unified inbox slices by folder client-side)
  page?: number
  pageSize?: number
} = {}): Promise<{ data: InboxMessage[]; page: number; pageSize: number }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = opts.pageSize ?? 50
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('intake_messages')
    .select(`
      id, subject, from_address, to_addresses, received_at, status, is_read, is_archived,
      thread_id, recipient_type, body_text,
      channel:intake_channels ( id, name, type ),
      review:intake_reviews (
        id, state, suggested_type, suggested_department, suggested_priority, suggested_confidence,
        is_starred, is_escalated, escalation_note,
        created_request_id, created_task_id,
        classification:intake_classifications!classification_id ( stage, provider )
      )
    `)
    .order('received_at', { ascending: false })
    .range(from, to)
  if (typeof opts.archived === 'boolean') query = query.eq('is_archived', opts.archived)

  const { data, error } = await query
  if (error) {
    // Most common cause: Phase D/D.5 migration not applied (missing is_archived
    // column / FK). Log loudly so the empty inbox isn't a silent failure.
    console.error('[getInboxMessages] query failed — is the Phase D migration applied?', error.message)
    return { data: [], page, pageSize }
  }
  // intake_reviews is 1:1 with message (UNIQUE FK) — PostgREST returns it as array; normalise.
  // body_text is truncated to a one-line preview snippet server-side so the client
  // payload stays small (we never ship full bodies to the list).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalised = (data ?? []).map((m: any) => {
    const review = Array.isArray(m.review) ? (m.review[0] ?? null) : (m.review ?? null)
    if (review) {
      const cls = Array.isArray(review.classification) ? review.classification[0] : review.classification
      review.stage = cls?.stage ?? null
      review.provider = cls?.provider ?? null
      delete review.classification
    }
    const snippet = typeof m.body_text === 'string'
      ? m.body_text.replace(/\s+/g, ' ').trim().slice(0, 160)
      : null
    const rest = { ...m } as Record<string, unknown>
    delete rest.body_text
    return { ...rest, review, snippet }
  })
  return { data: normalised as InboxMessage[], page, pageSize }
}

export type InboxMessageDetail = {
  id: string
  org_id: string
  subject: string | null
  from_address: string | null
  to_addresses: string[] | null
  cc_addresses: string[] | null
  body_text: string | null
  body_html: string | null
  received_at: string | null
  status: string
  is_read: boolean
  is_archived: boolean
  thread_id: string | null
  external_message_id: string | null
  channel: { id: string; name: string; type: string; default_team_id: string | null } | null
  review: {
    id: string
    state: string
    suggested_type: string | null
    suggested_department: string | null
    suggested_priority: string | null
    suggested_confidence: number | null
    was_overridden: boolean
    final_type: string | null
    final_department: string | null
    final_priority: string | null
    created_request_id: string | null
    created_task_id: string | null
    rationale: string | null
    provider: string | null
  } | null
}

export async function getInboxMessage(messageId: string): Promise<{
  message: InboxMessageDetail | null
  attachments: { id: string; file_name: string; file_size: number; mime_type: string | null; storage_path: string }[]
  thread: { id: string; subject: string | null; from_address: string | null; received_at: string | null }[]
}> {
  const supabase = (await createClient()) as unknown as AnyClient

  const { data: msg } = await supabase
    .from('intake_messages')
    .select(`
      id, org_id, subject, from_address, to_addresses, cc_addresses,
      body_text, body_html, received_at, status, is_read, is_archived,
      thread_id, external_message_id,
      channel:intake_channels ( id, name, type, default_team_id ),
      review:intake_reviews (
        id, state, was_overridden,
        suggested_type, suggested_department, suggested_priority, suggested_confidence,
        final_type, final_department, final_priority,
        created_request_id, created_task_id,
        classification:intake_classifications ( rationale, provider, stage )
      )
    `)
    .eq('id', messageId)
    .maybeSingle()

  if (!msg) return { message: null, attachments: [], thread: [] }

  // Normalise 1:1 relations that PostgREST returns as arrays.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawReview = Array.isArray((msg as any).review) ? (msg as any).review[0] ?? null : (msg as any).review ?? null
  let review = null
  if (rawReview) {
    const rawClass = Array.isArray(rawReview.classification) ? rawReview.classification[0] ?? null : rawReview.classification ?? null
    review = {
      ...rawReview,
      rationale: rawClass?.rationale ?? null,
      provider:  rawClass?.provider ?? null,
      classification: undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threadId = (msg as any).thread_id
  const [{ data: attachments }, { data: thread }] = await Promise.all([
    supabase.from('intake_attachments').select('id, file_name, file_size, mime_type, storage_path').eq('message_id', messageId),
    threadId
      ? supabase.from('intake_messages').select('id, subject, from_address, received_at').eq('thread_id', threadId).order('received_at', { ascending: true })
      : Promise.resolve({ data: [] }),
  ])

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: { ...(msg as any), review, channel: Array.isArray((msg as any).channel) ? (msg as any).channel[0] ?? null : (msg as any).channel } as InboxMessageDetail,
    attachments: (attachments ?? []) as never,
    thread: (thread ?? []) as never,
  }
}
