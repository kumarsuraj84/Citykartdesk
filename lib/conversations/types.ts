// Stage 4 — channel-neutral persistent conversation types. See
// STAGE_4_REPORT.md for the full architecture. Nothing here is
// WhatsApp/Meta-specific — Stage 5 maps a real transport's payloads onto
// these types.

export type ConversationState =
  | 'identified'
  | 'awaiting_service'
  | 'awaiting_issue_search'
  | 'awaiting_subcategory'
  | 'awaiting_description'
  | 'collecting_fields'
  | 'awaiting_file'
  | 'review'
  | 'submitting'
  | 'completed'
  | 'cancelled'
  | 'expired'

/** States that count as "an active conversation" for the Step 11 one-active-
 *  per-scope rule — mirrors the partial unique index's WHERE clause exactly
 *  (see the migration). */
export const ACTIVE_CONVERSATION_STATES: ConversationState[] = [
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

export const TERMINAL_CONVERSATION_STATES: ConversationState[] = ['completed', 'cancelled', 'expired']

export function isActiveState(state: ConversationState): boolean {
  return ACTIVE_CONVERSATION_STATES.includes(state)
}

/** Same channel vocabulary as the existing intake_channel_type enum
 *  (reused, not duplicated — see the migration's own comment). */
export type ConversationChannelType = 'email' | 'portal' | 'whatsapp' | 'teams' | 'slack' | 'api'

/** The persisted row shape — a 1:1 mirror of request_conversations, with
 *  Postgres's snake_case swapped for camelCase and its enums narrowed to
 *  the TS unions above. */
export type ConversationRow = {
  id: string
  orgId: string
  requesterId: string
  channelType: ConversationChannelType
  channelIdentity: string
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

  version: number
  lastActivityAt: string
  expiresAt: string

  createdAt: string
  updatedAt: string
  completedAt: string | null
  cancelledAt: string | null
  expiredAt: string | null
}

// ── Inbound (Step 8) ─────────────────────────────────────────────────────

export type ConversationCommand = 'new' | 'cancel' | 'restart' | 'create' | 'edit'

/**
 * Normalizes free-text into a known command, or null if it isn't one.
 * Case-insensitive, whitespace-tolerant (Step 10) — deliberately NOT a big
 * synonym table; a future channel-specific renderer maps friendlier phrases
 * ("Hi", "Start") onto these before calling into Stage 4.
 */
export function parseCommand(text: string): ConversationCommand | null {
  const normalized = text.trim().toLowerCase()
  switch (normalized) {
    case 'new':
      return 'new'
    case 'cancel':
      return 'cancel'
    case 'restart':
      return 'restart'
    case 'create':
      return 'create'
    case 'edit':
      return 'edit'
    default:
      return null
  }
}

export type ConversationInbound = {
  /** Idempotency key (Step 13) — the same externalMessageId must never
   *  advance conversation state twice. Required, non-empty. */
  externalMessageId: string

  orgId: string
  requesterId: string

  channelType: ConversationChannelType
  channelIdentity: string

  kind: 'text' | 'selection' | 'file' | 'command'

  /** Free text — an issue search, a description, a field answer, or a
   *  command (NEW/CANCEL/...), depending on `kind` and the conversation's
   *  current state. */
  text?: string
  /** A canonical id chosen from a previously-presented result set (e.g. a
   *  sub-category id) — never a bare numeric position (Step 6/19). */
  selectionId?: string

  attachment?: {
    externalMediaId?: string
    fileName?: string
    mimeType?: string
    size?: number
  }

  /** Audit-only (Step 27) — NEVER used to compute expiry or any other
   *  lifecycle/security decision. Server timestamps govern those. */
  receivedAt: string
}

// ── Media staging (Stage 5.1, Part 3) ───────────────────────────────────

/**
 * Injected by the transport layer into processConversationInbound() —
 * lib/conversations stays channel-neutral (no Meta/WhatsApp import
 * anywhere in this directory) while still being able to require that a
 * mandatory file field's media is genuinely retrieved, validated, and
 * durably stored BEFORE it can satisfy readiness. Mirrors the existing
 * dependency-injection idiom already used throughout this codebase (e.g.
 * WhatsAppGraphClient's injectable `fetchImpl`, every repository
 * function's injected `admin` client) rather than importing a
 * transport-specific module here.
 *
 * Called synchronously by handleFieldAnswer() the moment a `kind:'file'`
 * event arrives against a `file`-type field, BEFORE any readiness/state
 * decision is made — so by the time Stage 4 asks "is this field
 * satisfied?", the attachment row already carries its real, final-for-now
 * status ('staged' or 'failed'), never a bare unvalidated reference.
 *
 * If no stager is provided (no channel currently omits one, but the type
 * allows it), the attachment is recorded as a bare 'received_reference'
 * and — correctly, fail-safe by default — never satisfies a mandatory
 * field's readiness (see lib/conversations/file-progress.ts).
 */
export type MediaStager = (params: {
  orgId: string
  conversationId: string
  fieldId: string
  externalMediaId: string
  fileName: string | null
  mimeType: string | null
}) => Promise<
  | { ok: true; storagePath: string; mimeType: string; size: number }
  | { ok: false; reason: string }
>

export type ConversationInboundDeps = {
  mediaStager?: MediaStager
}

// ── Outbound (Step 9) ────────────────────────────────────────────────────

export type ConversationPromptType =
  | 'service_selection'
  | 'issue_search'
  | 'subcategory_selection'
  | 'text'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'number'
  | 'file'
  | 'review'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'active_draft_exists'
  | 'error'

export type ConversationPromptOption = { id: string; label: string }

export type ConversationPrompt = {
  type: ConversationPromptType
  message?: string
  options?: ConversationPromptOption[]
  /** Populated when type === 'review' — the actual Stage 3 requester-safe
   *  Review model (title/description/fields/readiness), not just a message.
   *  Typed loosely here (rather than importing RequestReviewModel) to keep
   *  this transport-neutral module free of a dependency on the
   *  questionnaire engine's own types; the orchestrator constructs the real
   *  shape. */
  review?: {
    serviceName: string
    subCategoryName: string | null
    description: string | null
    title: string
    fields: { fieldId: string; label: string; displayValue: string }[]
    ready: boolean
    missingFields: { key: string; label: string }[]
    invalidFields: { key: string; label: string; message: string }[]
  }
}

export type ConversationResult = {
  conversationId: string
  state: ConversationState
  prompt?: ConversationPrompt
  /** True when this result was replayed from a previously-processed event
   *  rather than freshly computed (Step 13) — lets a caller/renderer choose
   *  not to re-announce something the requester already saw, without Stage 4
   *  having to guess at channel-specific "don't resend" semantics. */
  duplicate?: boolean
}
