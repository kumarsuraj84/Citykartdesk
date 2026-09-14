import type { ConversationState } from './types'

/**
 * Step 15 — every legal transition, centralized. The orchestrator never
 * assigns `conversation.state = arbitraryString`; every state change goes
 * through transitionConversation() below, which throws on anything not
 * listed here.
 *
 * Two transitions are legal from EVERY active state and are added
 * separately rather than repeated in each row: →'cancelled' (the CANCEL
 * command) and →'expired' (lazy expiry), except 'submitting' — a
 * submission already in flight must not silently expire out from under
 * itself (Step 24), and is deliberately not cancellable either (see
 * ACTIVE_TERMINAL_ESCAPES below).
 *
 * "Config drift" backward transitions (Step 25 — a service/sub-category/
 * mandatory field becomes invalid between when it was answered and REVIEW/
 * CREATE) are listed explicitly alongside the normal forward path, not
 * treated as a special case — going back to an earlier collection state is
 * just as legal a transition as advancing.
 */
const FORWARD_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  identified: ['awaiting_service'],
  awaiting_service: ['awaiting_issue_search'],
  awaiting_issue_search: ['awaiting_issue_search', 'awaiting_subcategory', 'awaiting_service'],
  awaiting_subcategory: ['awaiting_description', 'awaiting_issue_search', 'awaiting_service'],
  awaiting_description: ['collecting_fields', 'awaiting_file', 'review', 'awaiting_service'],
  collecting_fields: ['collecting_fields', 'awaiting_file', 'review', 'awaiting_service', 'awaiting_subcategory'],
  awaiting_file: ['collecting_fields', 'awaiting_file', 'review', 'awaiting_service', 'awaiting_subcategory'],
  review: ['submitting', 'collecting_fields', 'awaiting_file', 'awaiting_service', 'awaiting_subcategory'],
  submitting: ['completed', 'review'],
  completed: [],
  cancelled: [],
  expired: [],
}

/** States a CANCEL command may act on. Excludes 'submitting' (a submission
 *  already in flight completes or fails on its own — see Step 24) and every
 *  terminal state (already inert). */
const CANCELLABLE_STATES: ConversationState[] = [
  'identified',
  'awaiting_service',
  'awaiting_issue_search',
  'awaiting_subcategory',
  'awaiting_description',
  'collecting_fields',
  'awaiting_file',
  'review',
]

/** States lazy expiry may act on. Same exclusion of 'submitting' as above. */
const EXPIRABLE_STATES: ConversationState[] = CANCELLABLE_STATES

export function canTransition(from: ConversationState, to: ConversationState): boolean {
  if (to === 'cancelled') return CANCELLABLE_STATES.includes(from)
  if (to === 'expired') return EXPIRABLE_STATES.includes(from)
  // Stage 7 UAT Findings F-29/F-30 — errorStayingPut() re-prompts a state
  // without actually changing it (an invalid/unrecognized reply, a
  // re-listed set of options, etc.), which needs `from -> from` to be
  // legal for every state it can be called from. Rather than remembering
  // to list every state under its own row (already missed twice — a bare
  // "awaiting_service" reply and a config-drift bounce from
  // "awaiting_description" both threw uncaught), grant the self-loop
  // blanket-legal for the same "active, not mid-submission" state set
  // CANCELLABLE_STATES already defines, exactly mirroring how 'cancelled'/
  // 'expired' are handled just above rather than being listed per-row.
  if (from === to) return CANCELLABLE_STATES.includes(from)
  return FORWARD_TRANSITIONS[from]?.includes(to) ?? false
}

/** Validates and returns `to` — throws on an illegal transition so a coding
 *  bug that would silently corrupt the state machine fails loudly instead. */
export function transitionConversation(from: ConversationState, to: ConversationState): ConversationState {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal conversation state transition: ${from} -> ${to}`)
  }
  return to
}
