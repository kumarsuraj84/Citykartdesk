import type { FormField, FormFieldOption } from '@/types'
import { filterFlatFieldsForRequester } from '@/lib/forms/sections'
import { isFieldValueEmpty } from '@/lib/validation/formFields'
import { flattenLeafOptions } from '@/lib/forms/options'
import {
  validateRequesterFormCompletion,
  type RequesterFormCompletionResult,
} from '@/lib/requests/validate-requester-form-completion'
import type { RequestDraft, RequestReviewModel, ReviewFieldEntry } from './types'
import { resolveDraftFormFields, type DraftFormService } from './question-plan'

/**
 * Step 14: the single authoritative completion/review-readiness check —
 * wraps validateRequesterFormCompletion() (the exact same gate
 * createRequestCore() itself enforces at actual creation time) rather than
 * duplicating its rules.
 *
 * Runs in STRICT file mode (treatFileFieldsAsSatisfied: false), unlike the
 * web form's lenient default. The web channel's leniency exists only because
 * request_attachments.request_id is a NOT NULL FK — a file can't be attached
 * before the request row exists, so the web form enforces required-ness
 * client-side instead. This engine has no attachment mechanism at all (Step
 * 13/21), so a required file field can never be honestly reported as
 * satisfied — strict mode correctly keeps the draft "not ready" until a real
 * attachment-presence value exists in `answers`, which nothing in Stage 3
 * ever writes there.
 */
export function checkDraftReadiness(
  service: DraftFormService,
  answers: Record<string, unknown>
): RequesterFormCompletionResult {
  return validateRequesterFormCompletion({ service, formData: answers, treatFileFieldsAsSatisfied: false })
}

function optionLabel(options: FormFieldOption[] | undefined, value: string): string {
  return flattenLeafOptions(options).find((o) => o.value === value)?.label ?? value
}

function formatFieldValueForDisplay(field: FormField, value: unknown): string {
  if (isFieldValueEmpty(value, field.type)) return ''
  if (field.type === 'multiselect' && Array.isArray(value)) {
    return value.map((v) => optionLabel(field.options, String(v))).join(', ')
  }
  if (field.type === 'select' || field.type === 'radio') {
    return optionLabel(field.options, String(value))
  }
  if (field.type === 'checkbox' || field.type === 'toggle') {
    return value ? 'Yes' : 'No'
  }
  return String(value)
}

/**
 * Step 15: builds the requester-safe Review model shown before creation —
 * technician-only/hidden fields (requester_can_view === false) are excluded
 * even if they somehow hold a value, and store_address (always
 * system-populated) is excluded too since it's never something the requester
 * answered. Pure — `subCategoryName` is passed in already-computed (see
 * catalog.ts) rather than fetched here, so this function does no I/O and
 * needs no client/mocking to test.
 *
 * Stage 3.1: `title` is read directly from `draft.title` — NEVER
 * regenerated here. `draft.title` is expected to already hold the output of
 * generateRequestTitle(), computed once after description collection (see
 * STAGE_3_1_REPORT.md "Idempotency"); Review must show the exact value that
 * will be stored on the created ticket, not a fresh computation that could
 * drift from it.
 */
export function buildReviewModel(params: {
  draft: RequestDraft
  service: DraftFormService & { id: string; name: string }
  subCategoryName: string | null
}): RequestReviewModel {
  const { draft, service, subCategoryName } = params

  const allFields = resolveDraftFormFields(service)
  const requesterFields = filterFlatFieldsForRequester(allFields)
  const readiness = checkDraftReadiness(service, draft.answers)

  const fields: ReviewFieldEntry[] = requesterFields
    .filter((f) => f.type !== 'store_address')
    .map((field): ReviewFieldEntry & { isEmpty: boolean } => {
      const value = draft.answers[field.id]
      return {
        fieldId: field.id, label: field.label, value,
        displayValue: formatFieldValueForDisplay(field, value),
        isEmpty: isFieldValueEmpty(value, field.type),
      }
    })
    .filter((entry) => !entry.isEmpty)
    .map(({ fieldId, label, value, displayValue }) => ({ fieldId, label, value, displayValue }))

  return {
    serviceId: service.id,
    serviceName: service.name,
    subCategoryId: draft.subCategoryId,
    subCategoryName,
    categoryId: draft.categoryId,
    description: draft.description,
    title: draft.title ?? '',
    fields,
    ready: readiness.valid,
    missingFields: readiness.missingFields,
    invalidFields: readiness.invalidFields,
  }
}
