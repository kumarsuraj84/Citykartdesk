import type { CreateRequestCoreParams, CreateRequestSource } from '@/lib/requests/create-request-core'
import type { RequestDraft } from './types'
import type { DraftFormService } from './question-plan'

export type DraftAdapterInput = Omit<CreateRequestCoreParams, 'client'>

export type DraftAdapterResult =
  | { ok: true; input: DraftAdapterInput }
  | { ok: false; error: string }

/**
 * Step 16: builds a createRequestCore()-compatible params object from a
 * completed draft. Deliberately never sets `priorityOverride` or
 * `teamIdOverride` — an unreviewed self-serve draft (WhatsApp or any future
 * channel built on this engine) must go through createRequestCore()'s own
 * DESK-controlled priority/SLA/team derivation exactly like a normal web
 * submission, never a human-reviewed shortcut (those two params stay
 * reserved for Email Intake's reviewer-confirmed conversion path — see their
 * doc comments on CreateRequestCoreParams). Does no direct DB insert of its
 * own; the caller is expected to pass `input` straight into
 * createRequestCore() alongside a `client`.
 *
 * Stage 3.1 contract — three independent, non-cross-mapped concepts:
 *   draft.description → createRequestCore()'s `description` → requests.description
 *   draft.title       → createRequestCore()'s `titleOverride` → requests.title
 *   draft.answers     → createRequestCore()'s `formData`      → requests.form_data
 * `draft.description` is NEVER written into `formData` (a textarea field
 * included) and `draft.title` never influences `formData` either — see
 * STAGE_3_1_REPORT.md "Description Contract" / "Title Contract".
 *
 * Pure — does no I/O and needs no client, so it's testable with a plain
 * draft + service object.
 */
export function buildCreateRequestInputFromDraft(params: {
  draft: RequestDraft
  service: DraftFormService
  source: CreateRequestSource
  intakeMessageId?: string | null
  sourceMetadata?: Record<string, unknown>
}): DraftAdapterResult {
  const { draft, source, intakeMessageId = null, sourceMetadata } = params

  if (!draft.serviceId) return { ok: false, error: 'No service selected.' }

  return {
    ok: true,
    input: {
      orgId: draft.orgId,
      requesterId: draft.requesterId,
      // Self-serve: the requester is creating their own ticket through the
      // conversation, so the acting user and the requester are the same
      // person — never a "book on behalf of" scenario.
      actingUserId: draft.requesterId,
      serviceId: draft.serviceId,
      subCategoryId: draft.subCategoryId,
      formData: { ...draft.answers },
      description: draft.description,
      titleOverride: draft.title ?? undefined,
      source,
      intakeMessageId,
      sourceMetadata,
      // No browser session bound to the requester for a channel like
      // WhatsApp — writes must go through the admin client, exactly as
      // documented on CreateRequestCoreParams.useAdminForWrites.
      useAdminForWrites: true,
    },
  }
}
