import { createAdminClient } from '@/lib/supabase/admin'
import { listQuestionnaireServices, searchSubCategories } from '@/lib/requests/questionnaire/catalog'
import { selectSubCategoryForDraft } from '@/lib/requests/questionnaire/subcategory'
import { resolveDraftFormFields, getNextQuestion, applySemanticRoleAutofill, type DraftFormService } from '@/lib/requests/questionnaire/question-plan'
import { applyQuestionAnswer } from '@/lib/requests/questionnaire/answers'
import { checkDraftReadiness, buildReviewModel } from '@/lib/requests/questionnaire/review'
import { generateRequestTitle } from '@/lib/requests/questionnaire/title'
import { buildCreateRequestInputFromDraft } from '@/lib/requests/questionnaire/adapter'
import type { RequestDraft } from '@/lib/requests/questionnaire/types'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { transitionConversation } from './state-machine'
import {
  claimEvent,
  completeEventOnly,
  commitTransition,
  createConversation,
  expireIfStale,
  findActiveConversation,
  findAttachmentsForConversation,
  findConversationById,
  insertAttachment,
  type ConversationAttachment,
  type ConversationTransitionInput,
} from './repository'
import { buildLogicalAnswers, reconcileReviewForAttachments } from './file-progress'
import {
  isActiveState, parseCommand,
  type ConversationInbound, type ConversationInboundDeps, type ConversationPrompt, type ConversationResult, type ConversationRow, type ConversationState,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any; auth: any; storage: any }

/** Step 12 default — no existing Intake semantics strongly suggested a
 *  different Phase-1 inactivity window, so the brief's own recommended
 *  default is used as-is. */
const CONVERSATION_INACTIVITY_HOURS = 24

/** Step 14 — bounded optimistic-concurrency retry. A genuinely contended
 *  conversation (two messages landing within milliseconds of each other)
 *  resolves within one or two retries; this bound exists only to fail
 *  loudly instead of spinning forever under a pathological, unexpected
 *  contention pattern. */
const MAX_COMMIT_ATTEMPTS = 5

/** Thrown whenever an optimistic-version commit loses its race. Carries the
 *  conversation id so the retry loop in processConversationInbound() can
 *  reload THAT specific conversation (by id, regardless of whether it has
 *  since moved to a terminal state) instead of re-resolving "the current
 *  active conversation for this scope" from scratch — which would find
 *  nothing once the winner has already driven it to 'completed'/'cancelled'
 *  and incorrectly report "no request in progress" to the loser. */
class ConversationConflict extends Error {
  constructor(public readonly conversationId?: string) {
    super('conversation_conflict')
  }
}

function addHours(date: Date, hours: number): string {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString()
}

function draftFromConversation(conversation: ConversationRow): RequestDraft {
  return {
    orgId: conversation.orgId,
    requesterId: conversation.requesterId,
    serviceId: conversation.serviceId,
    subCategoryId: conversation.subCategoryId,
    categoryId: conversation.categoryId,
    description: conversation.description,
    title: conversation.title,
    answers: conversation.answers,
  }
}

/** The COMPLETE next-row snapshot for commitTransition() — every field
 *  defaults to the conversation's current value unless explicitly
 *  overridden, so a handler only has to specify what's actually changing. */
function nextFrom(conversation: ConversationRow, overrides: Partial<ConversationTransitionInput> & { state: ConversationState }): ConversationTransitionInput {
  return {
    state: overrides.state,
    serviceId: overrides.serviceId !== undefined ? overrides.serviceId : conversation.serviceId,
    issueSearchText: overrides.issueSearchText !== undefined ? overrides.issueSearchText : conversation.issueSearchText,
    searchResultIds: overrides.searchResultIds !== undefined ? overrides.searchResultIds : conversation.searchResultIds,
    subCategoryId: overrides.subCategoryId !== undefined ? overrides.subCategoryId : conversation.subCategoryId,
    categoryId: overrides.categoryId !== undefined ? overrides.categoryId : conversation.categoryId,
    description: overrides.description !== undefined ? overrides.description : conversation.description,
    title: overrides.title !== undefined ? overrides.title : conversation.title,
    answers: overrides.answers !== undefined ? overrides.answers : conversation.answers,
    currentFieldId: overrides.currentFieldId !== undefined ? overrides.currentFieldId : conversation.currentFieldId,
    requestId: overrides.requestId !== undefined ? overrides.requestId : conversation.requestId,
    lastError: overrides.lastError !== undefined ? overrides.lastError : conversation.lastError,
    lastActivityAt: overrides.lastActivityAt ?? new Date().toISOString(),
    expiresAt: overrides.expiresAt ?? addHours(new Date(), CONVERSATION_INACTIVITY_HOURS),
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : conversation.completedAt,
    cancelledAt: overrides.cancelledAt !== undefined ? overrides.cancelledAt : conversation.cancelledAt,
    expiredAt: overrides.expiredAt !== undefined ? overrides.expiredAt : conversation.expiredAt,
  }
}

async function commitOrThrowConflict(params: {
  admin: AnyClient
  conversation: ConversationRow
  next: ConversationTransitionInput
  eventId: string
  result: ConversationResult
}): Promise<ConversationRow> {
  transitionConversation(params.conversation.state, params.next.state) // throws on an illegal transition — a coding-bug guard, not a user-facing check
  const commit = await commitTransition({
    admin: params.admin,
    conversation: params.conversation,
    next: params.next,
    eventId: params.eventId,
    eventResult: params.result,
  })
  if (!commit.ok) throw new ConversationConflict(params.conversation.id)
  return commit.conversation
}

// ── Service/sub-category reload helpers (Step 25 — never trust a stale
// selection; always reload current DESK configuration) ─────────────────────

type LoadedService = DraftFormService & { id: string; name: string }

async function loadService(admin: AnyClient, orgId: string, serviceId: string): Promise<LoadedService | null> {
  const { data } = await admin
    .from('services')
    .select('id, name, form_sections, form_fields, template:form_templates(form_sections)')
    .eq('id', serviceId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .eq('status', 'published')
    .maybeSingle()
  return data ?? null
}

async function loadSubCategoryName(admin: AnyClient, subCategoryId: string): Promise<string | null> {
  const { data } = await admin.from('service_sub_categories').select('name').eq('id', subCategoryId).maybeSingle()
  return data?.name ?? null
}

async function loadRequesterLocationId(admin: AnyClient, orgId: string, requesterId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('location_id').eq('id', requesterId).eq('org_id', orgId).maybeSingle()
  return data?.location_id ?? null
}

/** Step 26 — requester eligibility recheck before final CREATE. Stage 4
 *  does not re-resolve phone/WhatsApp identity itself (that stays Stage 2's
 *  job, performed before Stage 4 is ever invoked) — this only confirms the
 *  already-resolved requesterId is still a real, active, same-org profile. */
async function isRequesterStillEligible(admin: AnyClient, orgId: string, requesterId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('org_id, is_active').eq('id', requesterId).maybeSingle()
  return !!data && data.org_id === orgId && data.is_active === true
}

// ── Question-plan helpers (bridges Stage 3's pure functions + attachments) ──

async function nextStateAfterAnswers(params: {
  admin: AnyClient
  service: LoadedService
  answers: Record<string, unknown>
  conversationId: string
}): Promise<{ state: 'collecting_fields' | 'awaiting_file' | 'review'; currentFieldId: string | null }> {
  const allFields = resolveDraftFormFields(params.service)
  const attachments = await findAttachmentsForConversation({ admin: params.admin, conversationId: params.conversationId })
  const logical = buildLogicalAnswers(params.answers, attachments)
  const next = getNextQuestion(allFields, logical)
  if (!next) return { state: 'review', currentFieldId: null }
  return { state: next.type === 'file' ? 'awaiting_file' : 'collecting_fields', currentFieldId: next.id }
}

/** Builds the real Stage 3 Review model (never a placeholder message) for
 *  entering/re-displaying the review state — reconciled for any required
 *  file fields that already have a persisted attachment (Step 22). */
async function buildReviewPrompt(admin: AnyClient, conversation: ConversationRow, service: LoadedService): Promise<ConversationPrompt> {
  const subCategoryName = conversation.subCategoryId ? await loadSubCategoryName(admin, conversation.subCategoryId) : null
  const draft = draftFromConversation(conversation)
  const review = buildReviewModel({ draft, service, subCategoryName })
  const attachments = await findAttachmentsForConversation({ admin, conversationId: conversation.id })
  const allFields = resolveDraftFormFields(service)
  const reconciled = reconcileReviewForAttachments(review, allFields, attachments)
  return {
    type: 'review',
    message: reconciled.ready ? 'Please review your request.' : 'A few details are still needed.',
    review: {
      serviceName: reconciled.serviceName,
      subCategoryName: reconciled.subCategoryName,
      description: reconciled.description,
      title: reconciled.title,
      fields: reconciled.fields.map((f) => ({ fieldId: f.fieldId, label: f.label, displayValue: f.displayValue })),
      ready: reconciled.ready,
      missingFields: reconciled.missingFields,
      invalidFields: reconciled.invalidFields,
    },
  }
}

function questionPrompt(field: { id: string; type: string; label: string; options?: { value: string; label: string }[] }): ConversationResult['prompt'] {
  if (field.type === 'select' || field.type === 'radio') {
    return { type: 'select', message: field.label, options: (field.options ?? []).map((o) => ({ id: o.value, label: o.label })) }
  }
  if (field.type === 'multiselect') {
    return { type: 'multiselect', message: field.label, options: (field.options ?? []).map((o) => ({ id: o.value, label: o.label })) }
  }
  if (field.type === 'date') return { type: 'date', message: field.label }
  if (field.type === 'number') return { type: 'number', message: field.label }
  if (field.type === 'file') return { type: 'file', message: field.label }
  return { type: 'text', message: field.label }
}

// ── Public entry point (Step 16) ────────────────────────────────────────

/**
 * The single channel-neutral entry point for an inbound conversational
 * event. Guarantees (per STAGE_4_REPORT.md): the same externalMessageId
 * never advances state twice (Step 13), concurrent events against the same
 * conversation never corrupt each other (Step 14), and every business
 * decision is made by calling the real, current Stage 3 questionnaire
 * functions — nothing here reimplements catalog search, answer validation,
 * readiness, review, or ticket creation.
 */
export async function processConversationInbound(input: ConversationInbound, deps: ConversationInboundDeps = {}): Promise<ConversationResult> {
  const admin = createAdminClient() as unknown as AnyClient

  const claim = await claimEvent({ admin, orgId: input.orgId, channelType: input.channelType, externalMessageId: input.externalMessageId })
  if (claim.status === 'completed') return { ...claim.result, duplicate: true }

  const eventId = claim.eventId

  // Tracks the conversation id a losing attempt was actually working with
  // (see ConversationConflict's own doc comment) — once known, a retry
  // reloads THAT specific conversation by id (whatever state it raced to,
  // including a terminal one) instead of re-resolving "the current active
  // conversation for this scope," which would find nothing once a
  // concurrent winner has already driven it to completed/cancelled.
  let knownConversationId: string | null = null
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    try {
      return await processOnce(admin, input, eventId, knownConversationId, deps)
    } catch (e) {
      if (e instanceof ConversationConflict) {
        knownConversationId = e.conversationId ?? knownConversationId
        continue
      }
      throw e
    }
  }
  throw new Error('[conversations] exceeded retry attempts under contention')
}

async function processOnce(admin: AnyClient, input: ConversationInbound, eventId: string, knownConversationId: string | null, deps: ConversationInboundDeps): Promise<ConversationResult> {
  let conversation = knownConversationId
    ? await findConversationById({ admin, orgId: input.orgId, id: knownConversationId })
    : await findActiveConversation({
        admin,
        orgId: input.orgId,
        channelType: input.channelType,
        channelIdentity: input.channelIdentity,
      })

  // Step 12 — lazy expiry, checked against the server clock before anything
  // else, but only for a conversation that's actually still active — a
  // terminal conversation's expires_at is normally in the past too (it just
  // stopped mattering once it finished), and must never be relabeled
  // 'expired' after the fact.
  if (conversation && isActiveState(conversation.state)) {
    const beforeExpiry = conversation
    conversation = await expireIfStale({ admin, conversation })
    if (conversation.state === 'expired' && beforeExpiry.state !== 'expired') {
      await cleanupStagedAttachments(admin, conversation.id)
      const result: ConversationResult = {
        conversationId: conversation.id,
        state: 'expired',
        prompt: { type: 'expired', message: 'Your previous request session expired due to inactivity. Send NEW to start a new request.' },
      }
      await completeEventOnly({ admin, eventId, result })
      return result
    }
    if (conversation.state === 'expired') conversation = null // already expired earlier; treat as no active conversation
  }

  const command = input.kind !== 'file' && input.text ? parseCommand(input.text) : null

  if (command === 'new') return handleNew(admin, input, eventId, conversation)
  if (command === 'cancel') return handleCancel(admin, input, eventId, conversation)
  if (command === 'create') return handleCreate(admin, input, eventId, conversation)
  if (command === 'restart') return handleRestart(admin, input, eventId, conversation)
  if (command === 'edit') return handleEdit(admin, eventId, conversation)

  if (!conversation) {
    const result: ConversationResult = {
      conversationId: '',
      state: 'expired',
      prompt: { type: 'error', message: 'No request in progress. Send NEW to start one.' },
    }
    await completeEventOnly({ admin, eventId, result })
    return result
  }

  return routeToState(admin, input, eventId, conversation, deps)
}

/**
 * Stage 5.1 (Part 3, "Cancel/Expiry Cleanup") — best-effort deletes the
 * durable Storage object behind every STAGED (not yet LINKED into a real
 * ticket) attachment once a conversation becomes terminal via cancel or
 * lazy expiry, so a staged binary never outlives the draft it belonged to.
 * Deliberately generic (Supabase Storage only, no Meta/WhatsApp-specific
 * code) — reused by any future channel's staged attachments, not a
 * WhatsApp-only cleanup path. Never blocks or fails the cancel/expire
 * transition itself: storage errors are swallowed (the DB row + its
 * storage_path remain as an audit trail either way).
 */
async function cleanupStagedAttachments(admin: AnyClient, conversationId: string): Promise<void> {
  try {
    const attachments = await findAttachmentsForConversation({ admin, conversationId })
    const paths = attachments.filter((a) => a.status === 'staged' && a.storagePath).map((a) => a.storagePath as string)
    if (paths.length === 0) return
    await admin.storage.from('request-attachments').remove(paths)
  } catch {
    // best-effort — a storage cleanup failure must never block cancel/expiry
  }
}

// ── Commands (Step 10) ──────────────────────────────────────────────────

async function handleNew(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow | null): Promise<ConversationResult> {
  if (conversation) {
    const result: ConversationResult = {
      conversationId: conversation.id,
      state: conversation.state,
      prompt: {
        type: 'active_draft_exists',
        message: 'You already have a request in progress. Reply RESTART to discard it and start over, or CANCEL to stop, or continue answering to resume.',
        options: [
          { id: 'restart', label: 'Restart' },
          { id: 'cancel', label: 'Cancel' },
        ],
      },
    }
    await completeEventOnly({ admin, eventId, result })
    return result
  }

  const { conversation: created } = await createConversation({
    admin,
    orgId: input.orgId,
    requesterId: input.requesterId,
    channelType: input.channelType,
    channelIdentity: input.channelIdentity,
    expiresAt: addHours(new Date(), CONVERSATION_INACTIVITY_HOURS),
  })

  const locationId = await loadRequesterLocationId(admin, input.orgId, input.requesterId)
  const services = await listQuestionnaireServices({ client: admin, orgId: input.orgId, requesterLocationId: locationId })

  const result: ConversationResult = {
    conversationId: created.id,
    state: 'awaiting_service',
    prompt: { type: 'service_selection', message: 'Which service do you need help with?', options: services.map((s) => ({ id: s.id, label: s.name })) },
  }
  await commitOrThrowConflict({
    admin,
    conversation: created,
    next: nextFrom(created, { state: 'awaiting_service' }),
    eventId,
    result,
  })
  return result
}

async function handleRestart(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow | null): Promise<ConversationResult> {
  if (conversation) {
    await cancelConversation(admin, conversation, eventId, null) // cancel silently; the NEW below produces the real response
  }
  return handleNew(admin, input, eventId, null)
}

async function cancelConversation(admin: AnyClient, conversation: ConversationRow, eventId: string, result: ConversationResult | null): Promise<ConversationRow> {
  const nowIso = new Date().toISOString()
  const cancelled = await commitOrThrowConflict({
    admin,
    conversation,
    next: nextFrom(conversation, { state: 'cancelled', cancelledAt: nowIso }),
    eventId,
    result: result ?? { conversationId: conversation.id, state: 'cancelled', prompt: { type: 'cancelled', message: 'Request cancelled.' } },
  })
  await cleanupStagedAttachments(admin, conversation.id)
  return cancelled
}

async function handleCancel(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow | null): Promise<ConversationResult> {
  if (!conversation) {
    const result: ConversationResult = { conversationId: '', state: 'cancelled', prompt: { type: 'error', message: 'No request in progress to cancel.' } }
    await completeEventOnly({ admin, eventId, result })
    return result
  }
  if (conversation.state === 'submitting') {
    const result: ConversationResult = { conversationId: conversation.id, state: 'submitting', prompt: { type: 'error', message: 'Your request is being submitted and cannot be cancelled right now.' } }
    await completeEventOnly({ admin, eventId, result })
    return result
  }
  const result: ConversationResult = { conversationId: conversation.id, state: 'cancelled', prompt: { type: 'cancelled', message: 'Request cancelled.' } }
  await cancelConversation(admin, conversation, eventId, result)
  return result
}

async function handleEdit(admin: AnyClient, eventId: string, conversation: ConversationRow | null): Promise<ConversationResult> {
  if (!conversation || conversation.state !== 'review') {
    const result: ConversationResult = {
      conversationId: conversation?.id ?? '',
      state: conversation?.state ?? 'expired',
      prompt: { type: 'error', message: 'Nothing to edit right now.' },
    }
    await completeEventOnly({ admin, eventId, result })
    return result
  }
  // Phase 1 (Step 23) — deliberately conservative: list what's collected so
  // far rather than supporting arbitrary in-place field editing. A richer
  // "EDIT <field>" flow is a documented future enhancement, not built here.
  const service = await loadService(admin, conversation.orgId, conversation.serviceId!)
  if (!service) return sendBackToServiceSelection(admin, conversation, eventId, 'The selected service is no longer available.')
  const prompt = await buildReviewPrompt(admin, conversation, service)
  const result: ConversationResult = {
    conversationId: conversation.id,
    state: 'review',
    prompt: { ...prompt, message: 'Editing is limited in this version — reply CREATE to submit as-is, or CANCEL to discard.' },
  }
  await completeEventOnly({ admin, eventId, result })
  return result
}

// ── State routing (Steps 17-24) ──────────────────────────────────────────

async function routeToState(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow, deps: ConversationInboundDeps): Promise<ConversationResult> {
  switch (conversation.state) {
    case 'awaiting_service':
      return handleAwaitingService(admin, input, eventId, conversation)
    case 'awaiting_issue_search':
      return handleAwaitingIssueSearch(admin, input, eventId, conversation)
    case 'awaiting_subcategory':
      return handleAwaitingSubcategory(admin, input, eventId, conversation)
    case 'awaiting_description':
      return handleAwaitingDescription(admin, input, eventId, conversation)
    case 'collecting_fields':
    case 'awaiting_file':
      return handleFieldAnswer(admin, input, eventId, conversation, deps)
    case 'review':
      return handleReviewInput(admin, eventId, conversation)
    case 'submitting': {
      const result: ConversationResult = { conversationId: conversation.id, state: 'submitting', prompt: { type: 'error', message: 'Your request is being submitted — please wait.' } }
      await completeEventOnly({ admin, eventId, result })
      return result
    }
    default: {
      const result: ConversationResult = { conversationId: conversation.id, state: conversation.state, prompt: { type: 'error', message: 'This request can no longer be modified.' } }
      await completeEventOnly({ admin, eventId, result })
      return result
    }
  }
}

async function errorStayingPut(admin: AnyClient, conversation: ConversationRow, eventId: string, message: string, prompt?: ConversationResult['prompt']): Promise<ConversationResult> {
  const result: ConversationResult = { conversationId: conversation.id, state: conversation.state, prompt: prompt ?? { type: 'error', message } }
  // No state actually changes — still commit so the event is marked
  // completed and last_activity_at/expires_at refresh, without touching
  // version-sensitive draft fields.
  await commitOrThrowConflict({ admin, conversation, next: nextFrom(conversation, { state: conversation.state }), eventId, result })
  return result
}

async function sendBackToServiceSelection(admin: AnyClient, conversation: ConversationRow, eventId: string, message: string): Promise<ConversationResult> {
  const locationId = await loadRequesterLocationId(admin, conversation.orgId, conversation.requesterId)
  const services = await listQuestionnaireServices({ client: admin, orgId: conversation.orgId, requesterLocationId: locationId })
  const result: ConversationResult = {
    conversationId: conversation.id,
    state: 'awaiting_service',
    prompt: { type: 'service_selection', message, options: services.map((s) => ({ id: s.id, label: s.name })) },
  }
  await commitOrThrowConflict({
    admin,
    conversation,
    next: nextFrom(conversation, {
      state: 'awaiting_service',
      serviceId: null, subCategoryId: null, categoryId: null, issueSearchText: null, searchResultIds: null,
      description: null, title: null, answers: {}, currentFieldId: null,
    }),
    eventId,
    result,
  })
  return result
}

// Step 17
async function handleAwaitingService(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow): Promise<ConversationResult> {
  const selectedId = input.selectionId ?? input.text?.trim()
  if (!selectedId) return errorStayingPut(admin, conversation, eventId, 'Please choose a service.')

  const locationId = await loadRequesterLocationId(admin, conversation.orgId, conversation.requesterId)
  const services = await listQuestionnaireServices({ client: admin, orgId: conversation.orgId, requesterLocationId: locationId })
  const match = services.find((s) => s.id === selectedId)
  if (!match) {
    return errorStayingPut(admin, conversation, eventId, 'That service is not available. Please choose one from the list.', {
      type: 'service_selection', message: 'That service is not available. Please choose one from the list.',
      options: services.map((s) => ({ id: s.id, label: s.name })),
    })
  }

  const result: ConversationResult = {
    conversationId: conversation.id,
    state: 'awaiting_issue_search',
    prompt: { type: 'issue_search', message: `What issue are you facing with ${match.name}? Describe it in a few words.` },
  }
  await commitOrThrowConflict({
    admin,
    conversation,
    next: nextFrom(conversation, { state: 'awaiting_issue_search', serviceId: match.id }),
    eventId,
    result,
  })
  return result
}

// Step 18
async function handleAwaitingIssueSearch(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow): Promise<ConversationResult> {
  const query = input.text?.trim()
  if (!query) return errorStayingPut(admin, conversation, eventId, 'Please describe the issue in a few words.')

  const results = await searchSubCategories({ client: admin, orgId: conversation.orgId, serviceId: conversation.serviceId!, query })

  if (results.length === 0) {
    const result: ConversationResult = {
      conversationId: conversation.id,
      state: 'awaiting_issue_search',
      prompt: { type: 'issue_search', message: 'No matching issue types found. Try describing it differently.' },
    }
    await commitOrThrowConflict({
      admin,
      conversation,
      next: nextFrom(conversation, { state: 'awaiting_issue_search', issueSearchText: query, searchResultIds: [] }),
      eventId,
      result,
    })
    return result
  }

  const result: ConversationResult = {
    conversationId: conversation.id,
    state: 'awaiting_subcategory',
    prompt: { type: 'subcategory_selection', message: 'Which of these matches your issue?', options: results.map((r) => ({ id: r.id, label: r.name })) },
  }
  await commitOrThrowConflict({
    admin,
    conversation,
    next: nextFrom(conversation, { state: 'awaiting_subcategory', issueSearchText: query, searchResultIds: results.map((r) => r.id) }),
    eventId,
    result,
  })
  return result
}

// Step 19
async function handleAwaitingSubcategory(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow): Promise<ConversationResult> {
  const selectedId = input.selectionId ?? input.text?.trim()
  // Step 6/19 — never trust a bare position; the id must be one of the
  // canonical ids actually presented for THIS search, not just any valid
  // sub-category id that happens to exist somewhere in the org.
  if (!selectedId || !(conversation.searchResultIds ?? []).includes(selectedId)) {
    const results = await searchSubCategories({ client: admin, orgId: conversation.orgId, serviceId: conversation.serviceId!, query: conversation.issueSearchText ?? '' })
    return errorStayingPut(admin, conversation, eventId, 'Please pick one of the options shown.', {
      type: 'subcategory_selection', message: 'Please pick one of the options shown.',
      options: results.map((r) => ({ id: r.id, label: r.name })),
    })
  }

  const selection = await selectSubCategoryForDraft({ client: admin, orgId: conversation.orgId, serviceId: conversation.serviceId!, subCategoryId: selectedId })
  if (!selection.ok) {
    const results = await searchSubCategories({ client: admin, orgId: conversation.orgId, serviceId: conversation.serviceId!, query: conversation.issueSearchText ?? '' })
    return errorStayingPut(admin, conversation, eventId, selection.error, {
      type: 'subcategory_selection', message: selection.error,
      options: results.map((r) => ({ id: r.id, label: r.name })),
    })
  }

  const result: ConversationResult = {
    conversationId: conversation.id,
    state: 'awaiting_description',
    prompt: { type: 'text', message: 'Please describe the issue in detail.' },
  }
  await commitOrThrowConflict({
    admin,
    conversation,
    next: nextFrom(conversation, { state: 'awaiting_description', subCategoryId: selection.subCategoryId, categoryId: selection.categoryId }),
    eventId,
    result,
  })
  return result
}

// Step 20
async function handleAwaitingDescription(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow): Promise<ConversationResult> {
  const description = input.text?.trim()
  if (!description) return errorStayingPut(admin, conversation, eventId, 'Please share a few details about the issue.')

  const service = await loadService(admin, conversation.orgId, conversation.serviceId!)
  if (!service) return sendBackToServiceSelection(admin, conversation, eventId, 'This service is no longer available. Please choose another.')

  // Title generated exactly once (Step 7/AC-4.6) — never regenerated on a
  // later resume/retry, since draft.title is only ever set here, the one
  // place it's still null.
  let title = conversation.title
  if (title == null) {
    const subCategoryName = conversation.subCategoryId ? await loadSubCategoryName(admin, conversation.subCategoryId) : null
    title = await generateRequestTitle({ serviceName: service.name, subCategoryName, description })
  }

  // Stage 7.1 — Subject/Description double-ask fix: any template field
  // explicitly mapped via semantic_role gets auto-filled from the title/
  // description the engine just captured, BEFORE computing what's still
  // unanswered — so it's never asked again. See
  // question-plan.ts:applySemanticRoleAutofill() for why this stays
  // consistent with Stage 3.1's "answers-only, no label-guessing" rule.
  const allFields = resolveDraftFormFields(service)
  const answers = applySemanticRoleAutofill(allFields, conversation.answers, { title, description })

  const { state, currentFieldId } = await nextStateAfterAnswers({ admin, service, answers, conversationId: conversation.id })
  const nextField = currentFieldId ? allFields.find((f) => f.id === currentFieldId) : null

  const result: ConversationResult =
    state === 'review'
      ? { conversationId: conversation.id, state: 'review', prompt: await buildReviewPrompt(admin, { ...conversation, description, title, answers }, service) }
      : { conversationId: conversation.id, state, prompt: nextField ? questionPrompt(nextField) : { type: 'text' } }

  await commitOrThrowConflict({
    admin,
    conversation,
    next: nextFrom(conversation, { state, description, title, currentFieldId, answers }),
    eventId,
    result,
  })
  return result
}

// Step 21/22
async function handleFieldAnswer(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow, deps: ConversationInboundDeps): Promise<ConversationResult> {
  const service = await loadService(admin, conversation.orgId, conversation.serviceId!)
  if (!service) return sendBackToServiceSelection(admin, conversation, eventId, 'This service is no longer available. Please choose another.')

  const allFields = resolveDraftFormFields(service)
  const currentField = conversation.currentFieldId ? allFields.find((f) => f.id === conversation.currentFieldId) : null

  // Step 25 — the field this conversation was waiting on may have been
  // removed/retyped since it was asked; if so, just recompute what's
  // actually still needed instead of erroring.
  if (!currentField) {
    const { state, currentFieldId } = await nextStateAfterAnswers({ admin, service, answers: conversation.answers, conversationId: conversation.id })
    return advanceAfterAnswer(admin, conversation, eventId, service, allFields, conversation.answers, state, currentFieldId)
  }

  if (currentField.type === 'file') {
    if (input.kind !== 'file' || !input.attachment) return errorStayingPut(admin, conversation, eventId, `${currentField.label} requires a file attachment.`, { type: 'file', message: currentField.label })
    const externalMediaId = input.attachment.externalMediaId ?? null
    const fileName = input.attachment.fileName ?? null
    const mimeType = input.attachment.mimeType ?? null

    // Stage 5.1 (Part 3) — the whole point of a required file field is that
    // a bare external_media_id must NEVER be enough to satisfy it. If the
    // transport provided a stager, retrieval/validation/durable-storage
    // happens HERE, synchronously, before any readiness decision — so
    // nextStateAfterAnswers() below (via file-progress.ts) only ever sees
    // an attachment whose real, final-for-now status it can trust.
    const staged = deps.mediaStager && externalMediaId
      ? await deps.mediaStager({ orgId: conversation.orgId, conversationId: conversation.id, fieldId: currentField.id, externalMediaId, fileName, mimeType })
      : null

    if (staged?.ok) {
      await insertAttachment({
        admin, conversationId: conversation.id, fieldId: currentField.id,
        externalMediaId, fileName, mimeType, size: input.attachment.size ?? null,
        status: 'staged', storagePath: staged.storagePath, stagedMimeType: staged.mimeType, stagedSize: staged.size,
      })
    } else {
      const failureReason = staged && !staged.ok ? staged.reason : (deps.mediaStager && !externalMediaId ? 'No media reference received.' : null)
      await insertAttachment({
        admin, conversationId: conversation.id, fieldId: currentField.id,
        externalMediaId, fileName, mimeType, size: input.attachment.size ?? null,
        // A stager that was actually invoked and failed means this specific
        // media is genuinely bad (wrong type, too large, download failed,
        // etc.) — recorded 'failed' so it can never satisfy readiness and
        // the requester is told clearly, not left silently stuck. Only when
        // NO stager was ever wired (a channel that doesn't support staging)
        // does the bare 'received_reference' fallback apply — which,
        // correctly, also never satisfies a mandatory field on its own.
        status: deps.mediaStager ? 'failed' : 'received_reference',
        lastError: failureReason,
      })
      if (deps.mediaStager) {
        const message = `We couldn't use that file${failureReason ? ` (${failureReason})` : ''}. Please try sending it again.`
        return errorStayingPut(admin, conversation, eventId, message, { type: 'file', message })
      }
    }

    const { state, currentFieldId } = await nextStateAfterAnswers({ admin, service, answers: conversation.answers, conversationId: conversation.id })
    return advanceAfterAnswer(admin, conversation, eventId, service, allFields, conversation.answers, state, currentFieldId)
  }

  let rawValue: unknown = input.kind === 'selection' ? (input.selectionId ?? input.text) : input.text

  // A tap-based transport (WhatsApp interactive replies) can only submit one
  // value per message, but ConversationInbound has no array field to carry
  // several at once — so a multiselect field is answered as a single
  // free-text reply naming more than one option, comma-separated, either by
  // the option's own value or by its 1-based position in the SAME
  // currently-presented `currentField.options` order the prompt was just
  // rendered from (fresh every call, never a stale snapshot). Resolved into
  // a real array here so applyQuestionAnswer's existing multiselect handling
  // (lib/requests/questionnaire/answers.ts) needs no changes at all — this
  // is transport-shape resolution, not a new business rule. Any unresolved
  // token intentionally falls through to the ordinary raw string, which
  // applyQuestionAnswer will then reject with its normal "invalid option"
  // validation error rather than silently guessing.
  if (currentField.type === 'multiselect' && input.kind !== 'selection' && typeof input.text === 'string') {
    const tokens = input.text.split(',').map((t) => t.trim()).filter(Boolean)
    const options = currentField.options ?? []
    const resolved: string[] = []
    let allResolved = tokens.length > 0
    for (const token of tokens) {
      const index = Number(token)
      const byPosition = Number.isInteger(index) && index >= 1 && index <= options.length ? options[index - 1].value : undefined
      const byValue = options.find((o) => o.value === token)?.value
      const match = byPosition ?? byValue
      if (!match) { allResolved = false; break }
      resolved.push(match)
    }
    if (allResolved) rawValue = resolved
  }

  const applied = applyQuestionAnswer({ field: currentField, rawValue, answers: conversation.answers })
  if (!applied.ok) return errorStayingPut(admin, conversation, eventId, applied.error, questionPrompt(currentField))

  const { state, currentFieldId } = await nextStateAfterAnswers({ admin, service, answers: applied.answers, conversationId: conversation.id })
  return advanceAfterAnswer(admin, conversation, eventId, service, allFields, applied.answers, state, currentFieldId)
}

async function advanceAfterAnswer(
  admin: AnyClient,
  conversation: ConversationRow,
  eventId: string,
  service: LoadedService,
  allFields: ReturnType<typeof resolveDraftFormFields>,
  answers: Record<string, unknown>,
  state: 'collecting_fields' | 'awaiting_file' | 'review',
  currentFieldId: string | null
): Promise<ConversationResult> {
  const nextField = currentFieldId ? allFields.find((f) => f.id === currentFieldId) : null
  const result: ConversationResult =
    state === 'review'
      ? { conversationId: conversation.id, state: 'review', prompt: await buildReviewPrompt(admin, { ...conversation, answers }, service) }
      : { conversationId: conversation.id, state, prompt: nextField ? questionPrompt(nextField) : { type: 'text' } }

  await commitOrThrowConflict({
    admin,
    conversation,
    next: nextFrom(conversation, { state, answers, currentFieldId }),
    eventId,
    result,
  })
  return result
}

// Step 23
async function handleReviewInput(admin: AnyClient, eventId: string, conversation: ConversationRow): Promise<ConversationResult> {
  const service = await loadService(admin, conversation.orgId, conversation.serviceId!)
  const result: ConversationResult = service
    ? { conversationId: conversation.id, state: 'review', prompt: await buildReviewPrompt(admin, conversation, service) }
    : { conversationId: conversation.id, state: 'review', prompt: { type: 'error', message: 'This service is no longer available.' } }
  await completeEventOnly({ admin, eventId, result })
  return result
}

// Step 24/25
async function handleCreate(admin: AnyClient, input: ConversationInbound, eventId: string, conversation: ConversationRow | null): Promise<ConversationResult> {
  if (!conversation) {
    const result: ConversationResult = { conversationId: '', state: 'expired', prompt: { type: 'error', message: 'No request in progress to create.' } }
    await completeEventOnly({ admin, eventId, result })
    return result
  }

  if (conversation.state === 'submitting') {
    const result: ConversationResult = { conversationId: conversation.id, state: 'submitting', prompt: { type: 'error', message: 'Your request is already being submitted — please wait.' } }
    await completeEventOnly({ admin, eventId, result })
    return result
  }

  if (conversation.state === 'completed') {
    // Step 24 — a later CREATE for an already-completed conversation must
    // never create a second request; the terminal state + request_id link
    // IS the double-create guard, independent of external message ids.
    const result: ConversationResult = {
      conversationId: conversation.id,
      state: 'completed',
      prompt: { type: 'completed', message: `Already created (request ${conversation.requestId}).` },
    }
    await completeEventOnly({ admin, eventId, result })
    return result
  }

  if (conversation.state !== 'review') {
    const result: ConversationResult = { conversationId: conversation.id, state: conversation.state, prompt: { type: 'error', message: 'Please complete the request details before creating.' } }
    await completeEventOnly({ admin, eventId, result })
    return result
  }

  // Step 26 — requester eligibility recheck.
  const eligible = await isRequesterStillEligible(admin, conversation.orgId, conversation.requesterId)
  if (!eligible) {
    const result: ConversationResult = { conversationId: conversation.id, state: 'review', prompt: { type: 'error', message: 'Your account is no longer eligible to submit this request. Please contact your administrator.' } }
    await completeEventOnly({ admin, eventId, result })
    return result
  }

  // Step 25 — reload current configuration; a service/sub-category/field
  // that drifted invalid since REVIEW must send the conversation back to
  // collect what's actually needed now, never create against stale data.
  const service = await loadService(admin, conversation.orgId, conversation.serviceId!)
  if (!service) return sendBackToServiceSelection(admin, conversation, eventId, 'This service is no longer available. Please choose another.')

  if (conversation.subCategoryId) {
    const revalidated = await selectSubCategoryForDraft({ client: admin, orgId: conversation.orgId, serviceId: conversation.serviceId!, subCategoryId: conversation.subCategoryId })
    if (!revalidated.ok) {
      const results = await searchSubCategories({ client: admin, orgId: conversation.orgId, serviceId: conversation.serviceId!, query: conversation.issueSearchText ?? '' })
      const result: ConversationResult = {
        conversationId: conversation.id,
        state: 'awaiting_subcategory',
        prompt: { type: 'subcategory_selection', message: 'Your selected category is no longer valid — please choose again.', options: results.map((r) => ({ id: r.id, label: r.name })) },
      }
      await commitOrThrowConflict({ admin, conversation, next: nextFrom(conversation, { state: 'awaiting_subcategory', subCategoryId: null, categoryId: null }), eventId, result })
      return result
    }
  }

  const attachments = await findAttachmentsForConversation({ admin, conversationId: conversation.id })
  const logicalAnswers = buildLogicalAnswers(conversation.answers, attachments)
  const readiness = checkDraftReadiness(service, logicalAnswers)
  if (!readiness.valid) {
    // A new mandatory field appeared (readiness.missingFields), or a
    // previously-picked option was retired since it was answered
    // (readiness.invalidFields — the answer is still present and non-empty,
    // so getNextQuestion()'s plain empty-check alone would never re-ask
    // it). Never grandfather stale form data: an invalidated answer is
    // stripped from the REAL, persisted answers here — not just the
    // throwaway logical copy — so the field is genuinely empty again and
    // gets asked like any other missing field, instead of leaving the
    // conversation stuck on a field nothing will ever re-request.
    const cleanedAnswers = { ...conversation.answers }
    for (const invalid of readiness.invalidFields) delete cleanedAnswers[invalid.key]
    const cleanedLogical = buildLogicalAnswers(cleanedAnswers, attachments)

    const allFields = resolveDraftFormFields(service)
    const next = getNextQuestion(allFields, cleanedLogical)
    const state = next ? (next.type === 'file' ? 'awaiting_file' : 'collecting_fields') : 'collecting_fields'
    const result: ConversationResult = {
      conversationId: conversation.id,
      state,
      prompt: next ? questionPrompt(next) : { type: 'text', message: 'One more detail is needed before this request can be submitted.' },
    }
    await commitOrThrowConflict({ admin, conversation, next: nextFrom(conversation, { state, answers: cleanedAnswers, currentFieldId: next?.id ?? null }), eventId, result })
    return result
  }

  // ── Exclusive submission gate (Step 24 — DB-backed double-create guard).
  // Transitioning review -> submitting can only ever succeed once for a
  // given conversation version; a second concurrent/duplicate CREATE either
  // loses the optimistic-version race (retried by the outer loop, which
  // will then see state=submitting/completed above and refuse) or, if it
  // arrives after this commits, is refused by the state checks at the top
  // of this function.
  const submittingResult: ConversationResult = { conversationId: conversation.id, state: 'submitting', prompt: { type: 'text', message: 'Creating your request…' } }
  const submitting = await commitTransition({
    admin,
    conversation,
    next: nextFrom(conversation, { state: 'submitting' }),
  })
  if (!submitting.ok) throw new ConversationConflict(conversation.id)
  void submittingResult

  const draft = draftFromConversation(conversation)
  const adapted = buildCreateRequestInputFromDraft({ draft, service, source: mapChannelToSource(input.channelType), intakeMessageId: null })
  if (!adapted.ok) {
    return failCreation(admin, submitting.conversation, eventId, adapted.error)
  }

  try {
    const created = await createRequestCore({ client: admin, ...adapted.input })
    if (created.error || !created.requestId) {
      return failCreation(admin, submitting.conversation, eventId, created.error ?? 'Failed to create request.')
    }

    const nowIso = new Date().toISOString()
    const result: ConversationResult = {
      conversationId: submitting.conversation.id,
      state: 'completed',
      prompt: { type: 'completed', message: `Your request has been created (${created.requestNo}).` },
    }

    // The ticket now EXISTS — createRequestCore() must never be called
    // again for this conversation, so a lost version race on this specific
    // commit is retried locally (reload + re-attempt the same already-
    // decided 'completed' write) instead of bubbling a ConversationConflict
    // up to the outer loop, which would re-run the full CREATE handler
    // (including, on a fresh 'review'/'submitting' read, a second
    // createRequestCore() call — exactly the double-create this stage
    // exists to prevent).
    let finalConversation = await commitTransition({
      admin,
      conversation: submitting.conversation,
      next: nextFrom(submitting.conversation, { state: 'completed', requestId: created.requestId, lastError: null, completedAt: nowIso }),
      eventId,
      eventResult: result,
    })
    let retryCount = 0
    let latest = submitting.conversation
    while (!finalConversation.ok && retryCount < MAX_COMMIT_ATTEMPTS) {
      retryCount++
      const fresh = await findConversationById({ admin, orgId: latest.orgId, id: latest.id })
      if (!fresh) break
      latest = fresh
      finalConversation = await commitTransition({
        admin,
        conversation: latest,
        next: nextFrom(latest, { state: 'completed', requestId: created.requestId, lastError: null, completedAt: nowIso }),
        eventId,
        eventResult: result,
      })
    }
    if (!finalConversation.ok) {
      // Ticket created but the conversation could not be marked completed
      // after repeated retries — surfaced loudly rather than silently
      // dropped; see STAGE_4_REPORT.md "Known Gaps".
      console.error('[conversations] request created but failed to finalize conversation state', { requestId: created.requestId, conversationId: latest.id })
      throw new Error(`Request ${created.requestId} was created, but its conversation could not be marked completed after retries.`)
    }
    return result
  } catch (e) {
    // A genuine crash/exception here (as opposed to createRequestCore()'s
    // own returned {error}) leaves the conversation in 'submitting' with no
    // request_id and no last_error — deliberately NOT auto-recovered (see
    // STAGE_4_REPORT.md "CREATE / Double-Create Protection"): retrying
    // automatically here risks a duplicate ticket if createRequestCore()
    // actually partially succeeded, so Phase 1 fails safe (stuck, not
    // duplicated) and surfaces the exception for operator visibility.
    console.error('[conversations] unexpected error during createRequestCore()', e)
    throw e
  }
}

async function failCreation(admin: AnyClient, conversation: ConversationRow, eventId: string, error: string): Promise<ConversationResult> {
  const result: ConversationResult = { conversationId: conversation.id, state: 'review', prompt: { type: 'error', message: error } }
  const back = await commitTransition({
    admin,
    conversation,
    next: nextFrom(conversation, { state: 'review', lastError: error }),
    eventId,
    eventResult: result,
  })
  if (!back.ok) throw new ConversationConflict(conversation.id)
  return result
}

function mapChannelToSource(channelType: ConversationInbound['channelType']): 'whatsapp' | 'api' {
  return channelType === 'whatsapp' ? 'whatsapp' : 'api'
}

// Re-exported for tests/callers that need direct repository access without
// reaching into lib/conversations/repository.ts themselves.
export { findConversationById }
export type { ConversationAttachment }
