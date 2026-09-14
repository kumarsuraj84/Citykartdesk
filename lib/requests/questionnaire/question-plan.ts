import type { FormField } from '@/types'
import { resolveServiceFormSections, filterFlatFieldsForRequester, isRequesterMandatory, requesterCanView, requesterCanSet } from '@/lib/forms/sections'
import { isFieldValueEmpty } from '@/lib/validation/formFields'
import type { QuestionPlanItem } from './types'

export type DraftFormService = {
  form_sections?: unknown
  form_fields?: unknown
  template?: { form_sections?: unknown; form_fields?: unknown } | null
}

/** Step 8: resolve the SAME active form template/sections createRequestCore()
 *  and the web form both use — no second schema interpreter. */
export function resolveDraftFormFields(service: DraftFormService): FormField[] {
  const sections = resolveServiceFormSections(service)
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))
}

/**
 * Steps 9-10: the full requester-mandatory question set for this form, in
 * resolved order, each flagged with whether `answers` already satisfies it.
 *
 * Stage 3.1 correction: satisfied-field detection is ENTIRELY driven by
 * `answers` — `draft.description`/`draft.title` never count toward any
 * field here, a textarea included. A dynamic template field's meaning
 * cannot be inferred from `field.type === 'textarea'` alone (e.g. a
 * "Business Justification" textarea is not the requester's issue
 * description); the two concepts are kept fully independent (see
 * adapter.ts and STAGE_3_1_REPORT.md "Description Contract"). No
 * label-guessing was introduced as a replacement — only an explicit value
 * placed in `answers[field.id]` (via answers.ts's applyQuestionAnswer())
 * ever satisfies a template field.
 *
 * Excludes `store_address` (always system-populated, never askable) and
 * optional fields (optional fields never block progression, per product
 * decision). Deliberately INCLUDES mandatory `file` fields — this engine has
 * no attachment-collection mechanism (no Meta/WhatsApp code), so a required
 * file field is surfaced here as a real, unanswerable-by-this-engine
 * question rather than silently skipped; see answers.ts (applyQuestionAnswer
 * rejects `file`) and review.ts (checkDraftReadiness runs in strict file
 * mode) for how that's kept honest end-to-end instead of faked.
 */
export function buildQuestionPlan(allFields: FormField[], answers: Record<string, unknown>): QuestionPlanItem[] {
  const requesterFields = filterFlatFieldsForRequester(allFields)
  return requesterFields
    .filter((f) => f.type !== 'store_address')
    .filter(isRequesterMandatory)
    .map((field) => ({ field, alreadyAnswered: !isFieldValueEmpty(answers[field.id], field.type) }))
}

/** The next unanswered mandatory field to ask about, or null once the plan is
 *  fully satisfied. */
export function getNextQuestion(allFields: FormField[], answers: Record<string, unknown>): FormField | null {
  const plan = buildQuestionPlan(allFields, answers)
  return plan.find((item) => !item.alreadyAnswered)?.field ?? null
}

/**
 * Stage 7.1 — Subject/Description double-ask fix. Returns a NEW answers
 * object (never mutates the input) with `answers[field.id]` filled in for
 * every requester-visible/-settable field carrying an explicit
 * `semantic_role`, sourced from the engine's own already-captured
 * title/description — so buildQuestionPlan()/getNextQuestion() (which look
 * at nothing but `answers`, by Stage 3.1 design) naturally skip asking it
 * again, with zero special-casing in the question-plan logic itself.
 *
 * Deliberately never overwrites a field that already holds a real answer
 * (e.g. on resume, or if a requester somehow answered it before the
 * title/description existed) — auto-fill only ever fills a gap, never
 * clobbers an explicit answer. Values are plain strings once written, so
 * they land in `form_data` exactly like any other answered field and read
 * back identically on Review/resume.
 */
export function applySemanticRoleAutofill(
  allFields: FormField[],
  answers: Record<string, unknown>,
  values: { title: string | null; description: string | null }
): Record<string, unknown> {
  const bySlot: Record<'request_title' | 'request_description', string | null> = {
    request_title: values.title,
    request_description: values.description,
  }
  const overrides: Record<string, unknown> = {}
  for (const field of allFields) {
    const role = field.semantic_role
    if (role !== 'request_title' && role !== 'request_description') continue
    if (!requesterCanView(field) || !requesterCanSet(field)) continue
    const value = bySlot[role]
    if (value == null) continue
    if (!isFieldValueEmpty(answers[field.id], field.type)) continue
    overrides[field.id] = value
  }
  return Object.keys(overrides).length > 0 ? { ...answers, ...overrides } : answers
}
