import type { FormField, FormFieldType } from '@/types'
import { requesterCanView, requesterCanSet } from '@/lib/forms/sections'
import { flattenAllLeafOptions } from '@/lib/forms/options'

export type FieldAudience = 'requester' | 'technician'

// Permissive but real-world-useful — rejects obviously malformed input
// ("john", "a@b") without being pedantic about the RFC 5322 edge cases.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Domestic mobile numbers only: exactly 10 digits, no country code, no
// separators. Deliberately strict (not the old 7–15-digit/"+"-prefixed
// international pattern) per explicit product requirement.
export const PHONE_REGEX = /^[0-9]{10}$/

// Canonical stored date format — matches HTML5 `<input type="date">`'s own
// `value` format exactly (confirmed via components/forms/FieldRenderer.tsx),
// so the web form already produces this natively with no conversion. The
// conversational engine converts its own DD/MM/YYYY prompt format to this
// before it ever reaches validation — see
// lib/requests/questionnaire/answers.ts's normalizeAnswerValue().
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/** True only for a real calendar date in the canonical YYYY-MM-DD format —
 *  rejects malformed strings (Stage 7 Finding F-01: "not-a-real-date" was
 *  previously accepted) and impossible dates (2026-02-31) alike. Deliberately
 *  strict: no timezone/time-of-day component, no alternate separators. */
export function isValidCanonicalDate(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const asDate = new Date(Date.UTC(y, m - 1, d))
  return asDate.getUTCFullYear() === y && asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d
}

/**
 * Field-type-aware emptiness check (Stage 7 Finding F-02): a boolean
 * checkbox/toggle field is "answered" the moment it holds an actual `true`
 * or `false` — only a genuinely absent value (never touched) counts as
 * empty. Every other field type keeps its original behavior, including
 * `false` still counting as empty for them (unaffected — no other field
 * type stores a raw boolean). `fieldType` is optional and defaults to the
 * original behavior when omitted, so this stays a safe, additive change at
 * every call site that doesn't (yet) pass it.
 */
export function isFieldValueEmpty(val: unknown, fieldType?: FormFieldType): boolean {
  if (fieldType === 'checkbox' || fieldType === 'toggle') {
    return val === undefined || val === null
  }
  return (
    val === undefined ||
    val === null ||
    val === '' ||
    val === false ||
    (Array.isArray(val) && val.length === 0)
  )
}

/** Whether `required` actually applies for the given audience — a field is
 *  requester-mandatory only when the requester can both see and set it;
 *  otherwise (hidden, or visible-but-read-only) a required field is the
 *  technician's responsibility instead. See lib/forms/sections.ts. */
function isRequiredFor(field: FormField, audience: FieldAudience): boolean {
  if (!field.required) return false
  const requesterFacing = requesterCanView(field) && requesterCanSet(field)
  return audience === 'requester' ? requesterFacing : !requesterFacing
}

/**
 * Validate a single dynamic-form field's submitted value against its type and
 * `required`/`validation` config. Returns an error message, or null if valid.
 * Shared by DynamicForm (client) and createRequest (server) so the two can
 * never drift out of sync — the server is the source of truth, the client
 * just gives the user faster feedback. `audience` decides whether `required`
 * applies — see isRequiredFor().
 */
export function validateFieldValue(field: FormField, value: unknown, audience: FieldAudience = 'requester'): string | null {
  // System-populated, never user input — empty is the correct, expected
  // value for an HO/Warehouse requester with no store_id, not a validation
  // failure. Exempt regardless of `required` or audience.
  if (field.type === 'store_address') return null
  if (isRequiredFor(field, audience) && isFieldValueEmpty(value, field.type)) {
    return `${field.label} is required.`
  }
  if (isFieldValueEmpty(value, field.type)) return null

  if (field.type === 'date') {
    if (typeof value !== 'string' || !isValidCanonicalDate(value)) {
      return `Enter a valid date for "${field.label}" (YYYY-MM-DD).`
    }
  }

  if (field.type === 'email') {
    if (!EMAIL_REGEX.test(String(value).trim())) {
      return `Enter a valid email address for "${field.label}".`
    }
  }

  if (field.type === 'phone') {
    if (!PHONE_REGEX.test(String(value).trim())) {
      return `Enter a valid 10-digit phone number for "${field.label}" (no country code).`
    }
  }

  // Option-membership: a submitted select/radio/multiselect value must be one
  // of the field's configured leaf options (archived options included — a
  // value that was valid when originally submitted must keep validating
  // forever, see flattenAllLeafOptions()'s own doc comment). Only enforced
  // when the field actually has options configured, so a field somehow
  // missing that metadata isn't newly broken. `checkbox`/`toggle` are
  // deliberately excluded — confirmed via FieldRenderer.tsx that both are
  // rendered with plain boolean semantics, never option lists.
  if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
    const validValues = new Set(flattenAllLeafOptions(field.options).map((o) => o.value))
    if (!validValues.has(String(value))) {
      return `"${value}" is not a valid option for "${field.label}".`
    }
  }

  if (field.type === 'multiselect' && field.options?.length && Array.isArray(value)) {
    const validValues = new Set(flattenAllLeafOptions(field.options).map((o) => o.value))
    const invalid = (value as unknown[]).filter((v) => !validValues.has(String(v)))
    if (invalid.length > 0) {
      return `"${invalid.join(', ')}" is not a valid option for "${field.label}".`
    }
  }

  if (field.type === 'text' || field.type === 'textarea') {
    const len = String(value).length
    if (field.validation?.min_length != null && len < field.validation.min_length) {
      return `${field.label} must be at least ${field.validation.min_length} characters.`
    }
    if (field.validation?.max_length != null && len > field.validation.max_length) {
      return `${field.label} must be at most ${field.validation.max_length} characters.`
    }
  }

  if (field.type === 'number') {
    const num = Number(value)
    if (Number.isNaN(num)) return `${field.label} must be a number.`
    if (field.validation?.min != null && num < field.validation.min) {
      return `${field.label} must be at least ${field.validation.min}.`
    }
    if (field.validation?.max != null && num > field.validation.max) {
      return `${field.label} must be at most ${field.validation.max}.`
    }
  }

  return null
}

/** Validate a set of fields against submitted values. Returns a map of fieldId → error message. */
export function validateFields(
  fields: FormField[],
  values: Record<string, unknown>,
  audience: FieldAudience = 'requester'
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const err = validateFieldValue(field, values[field.id], audience)
    if (err) errors[field.id] = err
  }
  return errors
}
