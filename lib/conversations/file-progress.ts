import type { FormField } from '@/types'
import type { RequestReviewModel } from '@/lib/requests/questionnaire/types'
import { isFieldValueEmpty } from '@/lib/validation/formFields'
import type { ConversationAttachment } from './repository'

/**
 * Step 22 — a required `file` field is only "satisfied" once a durable
 * attachment reference has been persisted for the correct conversation +
 * field (never because a renderer merely claimed "file uploaded", and never
 * via a fake value written into `answers`/form_data — see
 * lib/requests/questionnaire/answers.ts, which flatly rejects file answers).
 *
 * These helpers reconcile that fact with Stage 3's pure, attachment-unaware
 * question-plan/review functions, WITHOUT modifying Stage 3 code and
 * WITHOUT ever writing a fake marker into the persisted `answers` that
 * would leak into createRequestCore()'s formData. The trick: Stage 3's
 * functions only need SOME non-empty value to see a field as answered —
 * they never inspect what it contains — so a throwaway "logical" answers
 * object (built fresh here, never persisted, never sent to
 * createRequestCore()) can safely stand in for progression/readiness
 * decisions while the real, persisted `answers` stays exactly what Stage 3
 * expects: only genuine text/select/etc. answers, never a file marker.
 */

/** Stage 5.1 (Part 3) — a mandatory file field is satisfied ONLY once its
 *  attachment has reached a durable, validated status: 'staged' (validated
 *  and stored, pre-Create) or 'linked' (already promoted, post-Create — by
 *  the time review/readiness is recomputed for an already-completed
 *  conversation, though normally 'staged' is what review-time sees).
 *  'received_reference' (a bare, unvalidated media id) and 'failed' must
 *  NEVER satisfy a mandatory field — this is the exact gap Stage 5.1 closed
 *  (STAGE_5_1_REPORT.md "Mandatory Attachment Architecture — Before/After");
 *  Stage 5's original version counted ANY row regardless of status. */
const SATISFYING_STATUSES: ReadonlySet<ConversationAttachment['status']> = new Set(['staged', 'linked'])

function fieldIdsWithAttachments(attachments: ConversationAttachment[]): Set<string> {
  return new Set(attachments.filter((a) => SATISFYING_STATUSES.has(a.status)).map((a) => a.fieldId))
}

/** Builds a copy of `answers` with a placeholder value for every field that
 *  has a real, persisted attachment — safe to pass to getNextQuestion()/
 *  buildQuestionPlan()/checkDraftReadiness() for STATE-ADVANCEMENT purposes
 *  only. Never persist this object and never pass it to
 *  buildCreateRequestInputFromDraft()/createRequestCore(). */
export function buildLogicalAnswers(answers: Record<string, unknown>, attachments: ConversationAttachment[]): Record<string, unknown> {
  const withFiles = fieldIdsWithAttachments(attachments)
  if (withFiles.size === 0) return answers
  const logical = { ...answers }
  for (const fieldId of withFiles) {
    if (isFieldValueEmpty(logical[fieldId])) logical[fieldId] = true
  }
  return logical
}

/**
 * Post-processes a Stage 3 RequestReviewModel (built from the REAL,
 * attachment-unaware `answers`) so a required file field that already has a
 * persisted attachment no longer blocks readiness — without ever exposing
 * the internal attachment bookkeeping as a fake "field value" in the
 * requester-facing review.
 */
export function reconcileReviewForAttachments(
  review: RequestReviewModel,
  allFields: FormField[],
  attachments: ConversationAttachment[]
): RequestReviewModel {
  const withFiles = fieldIdsWithAttachments(attachments)
  if (withFiles.size === 0) return review

  const stillMissing = review.missingFields.filter((mf) => {
    const field = allFields.find((f) => f.id === mf.key)
    return !(field?.type === 'file' && withFiles.has(field.id))
  })

  return {
    ...review,
    missingFields: stillMissing,
    ready: stillMissing.length === 0 && review.invalidFields.length === 0,
  }
}
