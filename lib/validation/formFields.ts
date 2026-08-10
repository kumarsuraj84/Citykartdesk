import type { FormField } from '@/types'

// Permissive but real-world-useful — rejects obviously malformed input
// ("john", "a@b") without being pedantic about the RFC 5322 edge cases.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Accepts an optional leading "+" plus 7–15 digits, with spaces/dashes/dots/
// parens allowed as separators (covers international formats without forcing
// a specific country pattern).
export const PHONE_REGEX = /^\+?[0-9](?:[0-9\s\-().]*[0-9])?$/

function isEmpty(val: unknown): boolean {
  return (
    val === undefined ||
    val === null ||
    val === '' ||
    val === false ||
    (Array.isArray(val) && val.length === 0)
  )
}

/**
 * Validate a single dynamic-form field's submitted value against its type and
 * `required`/`validation` config. Returns an error message, or null if valid.
 * Shared by DynamicForm (client) and createRequest (server) so the two can
 * never drift out of sync — the server is the source of truth, the client
 * just gives the user faster feedback.
 */
export function validateFieldValue(field: FormField, value: unknown): string | null {
  if (field.required && isEmpty(value)) {
    return `${field.label} is required.`
  }
  if (isEmpty(value)) return null

  if (field.type === 'email') {
    if (!EMAIL_REGEX.test(String(value).trim())) {
      return `Enter a valid email address for "${field.label}".`
    }
  }

  if (field.type === 'phone') {
    const str = String(value).trim()
    const digitCount = str.replace(/\D/g, '').length
    if (!PHONE_REGEX.test(str) || digitCount < 7 || digitCount > 15) {
      return `Enter a valid phone number for "${field.label}".`
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
  values: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const err = validateFieldValue(field, values[field.id])
    if (err) errors[field.id] = err
  }
  return errors
}
