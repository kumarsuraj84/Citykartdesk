import type { ConversationChannelType, ConversationResult, ConversationRow, ConversationState } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

// ── Row mapping ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = any

function mapRow(row: DbRow): ConversationRow {
  return {
    id: row.id,
    orgId: row.org_id,
    requesterId: row.requester_id,
    channelType: row.channel_type,
    channelIdentity: row.channel_identity,
    state: row.state,
    serviceId: row.service_id,
    issueSearchText: row.issue_search_text,
    searchResultIds: row.search_result_ids,
    subCategoryId: row.sub_category_id,
    categoryId: row.category_id,
    description: row.description,
    title: row.title,
    answers: (row.answers ?? {}) as Record<string, unknown>,
    currentFieldId: row.current_field_id,
    requestId: row.request_id,
    lastError: row.last_error,
    version: row.version,
    lastActivityAt: row.last_activity_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    expiredAt: row.expired_at,
  }
}

const CONVERSATION_ACTIVE_STATES_SQL: ConversationState[] = [
  'identified',
  'awaiting_service',
  'awaiting_issue_search',
  'awaiting_subcategory',
  'awaiting_description',
  'collecting_fields',
  'awaiting_file',
  'review',
  'submitting',
]

// ── Idempotency (Step 13) ────────────────────────────────────────────────

export type ClaimOutcome =
  /** First delivery — genuinely new, proceed to process it. */
  | { status: 'new'; eventId: string }
  /** A prior delivery already finished — replay its stored result verbatim,
   *  never reprocess (this IS the idempotency guarantee, Step 13/AC-4.8). */
  | { status: 'completed'; eventId: string; result: ConversationResult }
  /** A prior delivery claimed this event but never reached completion
   *  (a crash between claiming and commitTransition() — see that
   *  function's own doc comment on why this is always safe to redo: the
   *  conversation itself is only ever mutated atomically together with the
   *  event being marked 'completed', so "still processing/failed" can only
   *  mean the conversation was never touched by the earlier attempt). Safe
   *  to reprocess from scratch using the same eventId. */
  | { status: 'in_flight'; eventId: string }

/**
 * Atomically claims `externalMessageId` for this org+channel — a single
 * INSERT, exactly the intake worker's own check-then-insert-then-catch-23505
 * pattern (api/src/intake/store.ts), relying on the DB's
 * UNIQUE(org_id, channel_type, external_message_id) as the race-safety net
 * rather than the pre-check alone.
 */
export async function claimEvent(params: {
  admin: AnyClient
  orgId: string
  channelType: ConversationChannelType
  externalMessageId: string
}): Promise<ClaimOutcome> {
  const { admin, orgId, channelType, externalMessageId } = params

  const { data, error } = await admin
    .from('conversation_events')
    .insert({ org_id: orgId, channel_type: channelType, external_message_id: externalMessageId, status: 'processing' })
    .select('id')
    .single()

  if (!error && data) return { status: 'new', eventId: data.id }

  if (error?.code === '23505') {
    const { data: existing, error: lookupError } = await admin
      .from('conversation_events')
      .select('id, status, result')
      .eq('org_id', orgId)
      .eq('channel_type', channelType)
      .eq('external_message_id', externalMessageId)
      .single()
    if (lookupError || !existing) throw new Error(`[conversations] claimed-but-not-found race on event lookup: ${lookupError?.message}`)

    if (existing.status === 'completed' && existing.result) {
      return { status: 'completed', eventId: existing.id, result: existing.result as ConversationResult }
    }
    return { status: 'in_flight', eventId: existing.id }
  }

  throw new Error(`[conversations] failed to claim event: ${error?.message}`)
}

// ── Conversation lookup / creation ──────────────────────────────────────

/** Loads the current active conversation for this scope, if any — no
 *  expiry handling here (see expireIfStale()), just the raw lookup. Always
 *  explicitly org-scoped (Step 28) — this repository is written to be safe
 *  under the admin/service-role client, which has no RLS protection. */
export async function findActiveConversation(params: {
  admin: AnyClient
  orgId: string
  channelType: ConversationChannelType
  channelIdentity: string
}): Promise<ConversationRow | null> {
  const { admin, orgId, channelType, channelIdentity } = params
  const { data } = await admin
    .from('request_conversations')
    .select('*')
    .eq('org_id', orgId)
    .eq('channel_type', channelType)
    .eq('channel_identity', channelIdentity)
    .in('state', CONVERSATION_ACTIVE_STATES_SQL)
    .maybeSingle()
  return data ? mapRow(data) : null
}

export async function findConversationById(params: { admin: AnyClient; orgId: string; id: string }): Promise<ConversationRow | null> {
  const { admin, orgId, id } = params
  const { data } = await admin.from('request_conversations').select('*').eq('org_id', orgId).eq('id', id).maybeSingle()
  return data ? mapRow(data) : null
}

/**
 * Step 12 — lazy expiry: if `conversation.expiresAt` is already in the past
 * (per the SERVER clock, never a sender-supplied timestamp), atomically
 * transitions it to 'expired' and returns the updated row. A concurrent
 * expiry/transition racing this one is resolved by the same optimistic
 * version check every other mutation uses — if this update loses the race,
 * the conversation was already moved on by something else, so the fresh row
 * is reloaded and returned instead of retried (expiry is never something to
 * force through).
 */
export async function expireIfStale(params: { admin: AnyClient; conversation: ConversationRow; now?: Date }): Promise<ConversationRow> {
  const { admin, conversation } = params
  const now = params.now ?? new Date()
  if (new Date(conversation.expiresAt).getTime() > now.getTime()) return conversation

  const nowIso = now.toISOString()
  const { data, error } = await admin
    .from('request_conversations')
    .update({ state: 'expired', expired_at: nowIso, last_activity_at: nowIso, version: conversation.version + 1 })
    .eq('id', conversation.id)
    .eq('version', conversation.version)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    const fresh = await findConversationById({ admin, orgId: conversation.orgId, id: conversation.id })
    return fresh ?? conversation
  }
  return mapRow(data)
}

/**
 * Step 10/11/34 — starts a brand-new conversation, relying on the partial
 * unique index (org_id, channel_type, channel_identity) WHERE state IN
 * (active...) to serialize a genuine race between two concurrent "start"
 * requests: the loser's INSERT fails with 23505, and it re-selects the
 * winner's row instead of erroring — "concurrent start -> one active
 * conversation", satisfied at the DB level, not by a SELECT-then-INSERT
 * check in application code.
 */
export async function createConversation(params: {
  admin: AnyClient
  orgId: string
  requesterId: string
  channelType: ConversationChannelType
  channelIdentity: string
  expiresAt: string
}): Promise<{ created: true; conversation: ConversationRow } | { created: false; conversation: ConversationRow }> {
  const { admin, orgId, requesterId, channelType, channelIdentity, expiresAt } = params

  const { data, error } = await admin
    .from('request_conversations')
    .insert({
      org_id: orgId,
      requester_id: requesterId,
      channel_type: channelType,
      channel_identity: channelIdentity,
      state: 'identified',
      expires_at: expiresAt,
    })
    .select('*')
    .single()

  if (!error && data) return { created: true, conversation: mapRow(data) }

  if (error?.code === '23505') {
    const existing = await findActiveConversation({ admin, orgId, channelType, channelIdentity })
    if (existing) return { created: false, conversation: existing }
  }

  throw new Error(`[conversations] failed to create conversation: ${error?.message}`)
}

// ── Atomic transition commit (Step 14) ──────────────────────────────────

export type ConversationTransitionInput = {
  state: ConversationState
  serviceId: string | null
  issueSearchText: string | null
  searchResultIds: string[] | null
  subCategoryId: string | null
  categoryId: string | null
  description: string | null
  title: string | null
  answers: Record<string, unknown>
  currentFieldId: string | null
  requestId: string | null
  lastError: string | null
  lastActivityAt: string
  expiresAt: string
  completedAt: string | null
  cancelledAt: string | null
  expiredAt: string | null
}

export type CommitResult =
  | { ok: true; conversation: ConversationRow }
  | { ok: false; conflict: true }

/**
 * The one atomic write this stage relies on for every message-driven
 * transition — a single call to commit_conversation_transition() (see the
 * migration), which inside ONE Postgres transaction (a) applies the full
 * next row state with an optimistic version check and (b) marks the
 * triggering event 'completed' with its result, so a crash between "state
 * advanced" and "event marked done" is impossible — either both happen or
 * neither does.
 *
 * Returns `{ok:false, conflict:true}` (never throws) on a version conflict
 * so the caller can reload and retry its own business-logic computation —
 * see lib/conversations/orchestrator.ts's bounded retry loop.
 */
export async function commitTransition(params: {
  admin: AnyClient
  conversation: ConversationRow
  next: ConversationTransitionInput
  eventId?: string | null
  eventResult?: ConversationResult | null
}): Promise<CommitResult> {
  const { admin, conversation, next, eventId = null, eventResult = null } = params

  const { data, error } = await admin.rpc('commit_conversation_transition', {
    p_conversation_id: conversation.id,
    p_expected_version: conversation.version,
    p_state: next.state,
    p_service_id: next.serviceId,
    p_issue_search_text: next.issueSearchText,
    p_search_result_ids: next.searchResultIds,
    p_sub_category_id: next.subCategoryId,
    p_category_id: next.categoryId,
    p_description: next.description,
    p_title: next.title,
    p_answers: next.answers,
    p_current_field_id: next.currentFieldId,
    p_request_id: next.requestId,
    p_last_error: next.lastError,
    p_last_activity_at: next.lastActivityAt,
    p_expires_at: next.expiresAt,
    p_completed_at: next.completedAt,
    p_cancelled_at: next.cancelledAt,
    p_expired_at: next.expiredAt,
    p_event_id: eventId,
    p_event_result: eventResult,
  })

  if (error) {
    if (error.message?.includes('conversation_version_conflict')) return { ok: false, conflict: true }
    throw new Error(`[conversations] commitTransition failed: ${error.message}`)
  }

  return { ok: true, conversation: mapRow(data) }
}

/** Marks a claimed event 'completed' without touching any conversation —
 *  for responses that don't advance a conversation at all (e.g. a command
 *  processed before any conversation exists). Kept separate from
 *  commitTransition() so that function's contract stays "always advances a
 *  real conversation row". */
export async function completeEventOnly(params: { admin: AnyClient; eventId: string; result: ConversationResult }): Promise<void> {
  const { admin, eventId, result } = params
  await admin.from('conversation_events').update({ status: 'completed', result }).eq('id', eventId)
}

// ── Attachments (Step 22) ────────────────────────────────────────────────

/**
 * Stage 5.1 — evolved from Stage 5's original three-status model.
 *   received_reference  a transport handed us a media id; NOT yet
 *                        downloaded/validated; NEVER satisfies a mandatory
 *                        file field's readiness on its own (see
 *                        file-progress.ts).
 *   staged               downloaded, MIME/magic-byte/size validated, and
 *                        durably stored at `storagePath` BEFORE Review/
 *                        Create — this is what "satisfied" now means.
 *   linked                promoted into request_attachments after
 *                        createRequestCore() succeeded, by copying the
 *                        already-staged object (never re-downloaded).
 *   failed                retrieval/validation/storage genuinely failed;
 *                        the field is re-asked, never silently satisfied.
 *   persisted             Stage 5's original terminal status — kept in the
 *                        DB enum for any pre-5.1 row, written by no code
 *                        path going forward.
 */
export type ConversationAttachment = {
  id: string
  conversationId: string
  fieldId: string
  externalMediaId: string | null
  fileName: string | null
  mimeType: string | null
  size: number | null
  status: 'received_reference' | 'staged' | 'linked' | 'failed' | 'persisted'
  storagePath: string | null
  stagedMimeType: string | null
  stagedSize: number | null
  lastError: string | null
  createdAt: string
}

function mapAttachment(row: DbRow): ConversationAttachment {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    fieldId: row.field_id,
    externalMediaId: row.external_media_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    status: row.status,
    storagePath: row.storage_path,
    stagedMimeType: row.staged_mime_type,
    stagedSize: row.staged_size,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

/**
 * Persists a durable attachment record for one field. `status` defaults to
 * 'received_reference' (the bare-reference case), but a transport that has
 * ALREADY retrieved/validated/stored the binary before calling this (Stage
 * 5's WhatsApp adapter, via its injected MediaStager — see orchestrator.ts)
 * passes the real outcome directly ('staged' + storagePath/stagedMimeType/
 * stagedSize, or 'failed' + lastError) so the row is correct from the
 * moment it's created — this is what makes a mandatory file field's
 * readiness check (file-progress.ts) trustworthy: it never has to assume a
 * bare reference will eventually resolve.
 */
export async function insertAttachment(params: {
  admin: AnyClient
  conversationId: string
  fieldId: string
  externalMediaId?: string | null
  fileName?: string | null
  mimeType?: string | null
  size?: number | null
  status?: ConversationAttachment['status']
  storagePath?: string | null
  stagedMimeType?: string | null
  stagedSize?: number | null
  lastError?: string | null
}): Promise<ConversationAttachment> {
  const {
    admin, conversationId, fieldId, externalMediaId = null, fileName = null, mimeType = null, size = null,
    status = 'received_reference', storagePath = null, stagedMimeType = null, stagedSize = null, lastError = null,
  } = params
  const { data, error } = await admin
    .from('conversation_attachments')
    .insert({
      conversation_id: conversationId,
      field_id: fieldId,
      external_media_id: externalMediaId,
      file_name: fileName,
      mime_type: mimeType,
      size,
      status,
      storage_path: storagePath,
      staged_mime_type: stagedMimeType,
      staged_size: stagedSize,
      last_error: lastError,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`[conversations] failed to insert attachment: ${error?.message}`)
  return mapAttachment(data)
}

export async function findAttachmentsForConversation(params: { admin: AnyClient; conversationId: string }): Promise<ConversationAttachment[]> {
  const { admin, conversationId } = params
  const { data } = await admin.from('conversation_attachments').select('*').eq('conversation_id', conversationId)
  return ((data ?? []) as DbRow[]).map(mapAttachment)
}

/** Stage 5.1 (Part 3) — moves an attachment to 'linked' once its
 *  already-staged binary has been promoted (copied, never re-downloaded)
 *  into the normal request_attachments model, or to 'failed' if that
 *  didn't succeed. Never touches conversation/ticket state — a failed
 *  promotion does not undo or duplicate ticket creation (see
 *  STAGE_5_1_REPORT.md "Post-Create Link-Failure Behavior"): the staged
 *  object itself is left in place (never deleted here) so a later
 *  reconciliation can still find and promote it. */
export async function updateAttachmentStatus(params: {
  admin: AnyClient
  attachmentId: string
  status: ConversationAttachment['status']
  lastError?: string | null
}): Promise<void> {
  const { admin, attachmentId, status, lastError } = params
  const patch: Record<string, unknown> = { status }
  if (lastError !== undefined) patch.last_error = lastError
  await admin.from('conversation_attachments').update(patch).eq('id', attachmentId)
}
