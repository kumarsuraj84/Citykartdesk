import type { FormField } from '@/types'

// ── RequestDraft ────────────────────────────────────────────────────────────
// The channel-neutral accumulator threaded through a questionnaire-driven
// ticket draft (self-serve web wizard today, WhatsApp tomorrow). Deliberately
// NOT named/typed around any channel, and deliberately NOT persisted anywhere
// — a caller (e.g. a future WhatsApp webhook handler) owns wherever it keeps
// this in memory/session for the duration of one conversation; nothing in
// this module writes it to a table. See STAGE_3_REPORT.md "No persistence".
export type RequestDraft = {
  orgId: string
  requesterId: string
  serviceId: string | null
  /** Selected + server-revalidated (see subcategory.ts) — never trust a
   *  caller-supplied id without re-checking it's tagged to serviceId. */
  subCategoryId: string | null
  /** Always derived FROM subCategoryId, never set directly — mirrors
   *  createRequestCore()'s own "category is never client-supplied" rule. */
  categoryId: string | null
  /** Stage 3.1: a first-class ticket property, collected verbatim (never AI-
   *  summarized/rewritten/relabeled) and mapped ONLY onto
   *  createRequestCore()'s own `description` passthrough → requests.description.
   *  Independent from `answers`/form_data — it is NEVER written into a
   *  dynamic template field (a textarea included), no matter what the
   *  resolved form happens to contain. See adapter.ts and
   *  STAGE_3_1_REPORT.md "Description Contract". */
  description: string | null
  /** Stage 3.1: a first-class, trusted, precomputed ticket title — generated
   *  once via generateRequestTitle() and carried forward unchanged through
   *  Review and creation (adapter.ts maps it to createRequestCore()'s
   *  `titleOverride`, which stores it on requests.title verbatim). Review
   *  must display exactly this value, never regenerate a different one — see
   *  STAGE_3_1_REPORT.md "Title Contract" / "Idempotency". */
  title: string | null
  /** Answers to the resolved form's requester-settable fields, fieldId → value.
   *  Same shape as createRequestCore()'s `formData` — this IS the formData,
   *  built up one question at a time instead of submitted all at once.
   *  Independent from `description`/`title` — neither is ever written in here. */
  answers: Record<string, unknown>
}

export function createEmptyDraft(params: { orgId: string; requesterId: string }): RequestDraft {
  return {
    orgId: params.orgId,
    requesterId: params.requesterId,
    serviceId: null,
    subCategoryId: null,
    categoryId: null,
    description: null,
    title: null,
    answers: {},
  }
}

// ── Catalog (Steps 2-3) ──────────────────────────────────────────────────────

export type QuestionnaireServiceSummary = {
  id: string
  name: string
  description: string | null
  slug: string
}

export type SubCategorySearchResult = {
  id: string
  name: string
  categoryId: string
  categoryName: string
  /** Higher = better match. Deterministic keyword scoring — see subcategory.ts. */
  score: number
}

// ── Question plan (Step 10) ─────────────────────────────────────────────────

export type QuestionPlanItem = {
  field: FormField
  /** Whether `answers` already holds a value for this field — a caller can
   *  use this to skip re-asking without needing to separately re-run
   *  satisfied-field logic. Note: `draft.description`/`draft.title` NEVER
   *  count toward this (Stage 3.1) — only an explicit answer in `answers`
   *  does, even for a textarea field. */
  alreadyAnswered: boolean
}

// ── Review (Step 15) ─────────────────────────────────────────────────────────

export type ReviewFieldEntry = {
  fieldId: string
  label: string
  value: unknown
  /** Human-readable rendering of `value` (option labels resolved, multiselect
   *  joined, etc.) — what a chat transcript or confirmation screen should show. */
  displayValue: string
}

export type RequestReviewModel = {
  serviceId: string
  serviceName: string
  subCategoryId: string | null
  subCategoryName: string | null
  categoryId: string | null
  /** Carried verbatim from draft.description — never regenerated here. */
  description: string | null
  /** Carried verbatim from draft.title — never regenerated here (Stage 3.1:
   *  Review must show the exact title that will be stored on the created
   *  ticket, not a freshly-computed one). */
  title: string
  /** Requester-visible fields only (requester_can_view) — never a
   *  technician-only/hidden field, even if it happens to have a value. */
  fields: ReviewFieldEntry[]
  ready: boolean
  missingFields: { key: string; label: string }[]
  invalidFields: { key: string; label: string; message: string }[]
}
