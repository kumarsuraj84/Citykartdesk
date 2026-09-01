import type { FormField } from '@/types'
import { requesterCanView, requesterCanSet } from '@/lib/forms/sections'

export type FieldAudience = 'requester' | 'technician'

// Permissive but real-world-useful — rejects obviously malformed input
// ("john", "a@b") without being pedantic about the RFC 5322 edge cases.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Domestic mobile numbers only: exactly 10 digits, no country code, no
// separators. Deliberately strict (not the old 7–15-digit/"+"-prefixed
// international pattern) per explicit product requirement.
export const PHONE_REGEX = /^[0-9]{10}$/

export function isFieldValueEmpty(val: unknown): boolean {
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
  if (isRequiredFor(field, audience) && isFieldValueEmpty(value)) {
    return `${field.label} is required.`
  }
  if (isFieldValueEmpty(value)) return null

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
