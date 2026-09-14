import type { FormField } from '@/types'
import { resolveServiceFormSections, filterFlatFieldsForRequester, isRequesterMandatory } from '@/lib/forms/sections'
import { validateFieldValue, isFieldValueEmpty } from '@/lib/validation/formFields'

export type RequesterFieldIssue = { key: string; label: string }
export type RequesterFieldInvalid = RequesterFieldIssue & { message: string }

export type RequesterFormCompletionResult = {
  valid: boolean
  missingFields: RequesterFieldIssue[]
  invalidFields: RequesterFieldInvalid[]
  /** Every requester-visible field (view+set), resolved section order — the
   *  set a requester-facing UI (web form or a WhatsApp questionnaire) should
   *  walk. Returned so callers don't have to re-resolve the service's form a
   *  second time. */
  requesterFields: FormField[]
  /** Every field on the resolved form, technician-only included — needed for
   *  callers (e.g. createRequestCore) that also derive SLA/title from fields
   *  the requester never sees. */
  allFields: FormField[]
}

/**
 * Server-side "is this request ready to create?" gate, shared by every
 * ticket-creation channel (web form, Email Intake, and eventually WhatsApp).
 * Resolves the service's *current* active form (template if tagged, else the
 * service's own sections/legacy fields — see resolveServiceFormSections()),
 * filters to what the requester can actually see, and validates every
 * requester-mandatory field against the exact same validateFieldValue() the
 * web form's client-side check and createRequestCore()'s server-side check
 * both already use — so a field newly marked mandatory on the template is
 * enforced everywhere the instant it's saved, with no per-channel code change.
 *
 * `treatFileFieldsAsSatisfied` (default true) preserves a known, deliberate,
 * pre-existing limitation: `file`-type fields are never present in
 * `requests.form_data` (request_attachments.request_id is a NOT NULL FK, so a
 * file can only be attached *after* the request row exists — see
 * createRequestCore()), so there is nothing in `formData` to check a file
 * field's required-ness against at this point in the flow. Required-ness for
 * `file` fields has always been enforced client-side only (DynamicForm's own
 * validate()) for the web channel. Passing `false` here switches this utility
 * into "strict" mode, where a `file` field's required-ness is checked the
 * same as every other field (i.e. the caller is expected to place a truthy
 * marker — e.g. an attachment count, or a staged-upload reference — into
 * `formData[field.id]` once something has actually been attached). WhatsApp's
 * attachment stage is expected to use strict mode once it has real
 * attachment-presence data to check against; nothing today does.
 */
export function validateRequesterFormCompletion(params: {
  service: {
    form_sections?: unknown
    form_fields?: unknown
    template?: { form_sections?: unknown; form_fields?: unknown } | null
  }
  formData: Record<string, unknown>
  treatFileFieldsAsSatisfied?: boolean
}): RequesterFormCompletionResult {
  const { service, formData, treatFileFieldsAsSatisfied = true } = params

  const sections = resolveServiceFormSections(service)
  const allFields: FormField[] = [...sections]
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))

  const requesterFields = filterFlatFieldsForRequester(allFields)

  const missingFields: RequesterFieldIssue[] = []
  const invalidFields: RequesterFieldInvalid[] = []

  for (const field of requesterFields) {
    const value = formData[field.id]
    // store_address is always system-populated (see createRequestCore()) —
    // never something to gate on, the same way validateFieldValue() itself
    // exempts it unconditionally for the "invalid value" check below.
    if (field.type === 'store_address') continue
    const skipRequiredCheck = field.type === 'file' && treatFileFieldsAsSatisfied

    if (isFieldValueEmpty(value, field.type)) {
      if (!skipRequiredCheck && isRequesterMandatory(field)) {
        missingFields.push({ key: field.id, label: field.label })
      }
      continue
    }

    // Has a value — run the same type-specific checks the web form and
    // createRequestCore() both use (email format, phone format, min/max
    // length, number range). validateFieldValue() only returns a message
    // here for a type-validation failure, never a "required" one, since the
    // value is already known non-empty.
    const message = validateFieldValue(field, value, 'requester')
    if (message) invalidFields.push({ key: field.id, label: field.label, message })
  }

  return {
    valid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
    requesterFields,
    allFields,
  }
}
