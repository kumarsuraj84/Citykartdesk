// Identity-level mobile number normalization — the ONE place every write
// path (Add User, Edit User, bulk import) and the WhatsApp identity resolver
// (lib/users/resolveWhatsAppUser.ts) derive/compare a Citykart user's mobile
// number. Do not duplicate this logic anywhere else.
//
// Explicit product decision (India-only, confirmed mid-Stage-2): Citykart
// operates exclusively with Indian employee numbers for this project. The
// canonical, single-source-of-truth format is a bare 10-digit Indian mobile
// number — e.g. '9876543210' — no country code, no leading zero, no '+', no
// separators. This is deliberately NOT E.164/international — there is no
// country selector and no support for a non-+91 number; see the repository's
// Stage 2 report for the reasoning and how this differs from an earlier
// E.164-based draft of this same utility.
//
// This is a distinct concept from the ticket-form `phone`-type dynamic
// field (lib/validation/formFields.ts's PHONE_REGEX) — that validates a
// value the requester types into a specific ticket's form_data, unrelated to
// who they are. This module is about WHO a mobile number identifies.

export type NormalizeMobileResult =
  | { ok: true; normalized: string }
  | { ok: false; error: string }

const INVALID_MESSAGE = 'Enter a valid 10-digit Indian mobile number (e.g. 9876543210).'

// Indian mobile numbers are 10 digits, first digit 6-9 (the TRAI-allocated
// mobile range — 0-5 as a first digit is a landline/other series, never a
// mobile number).
const INDIA_MOBILE_REGEX = /^[6-9][0-9]{9}$/

/**
 * Normalizes a human-entered mobile number into the canonical bare 10-digit
 * form. Accepts common Indian representations (with or without a leading 0,
 * 91, or +91, and common separators — spaces/hyphens/dots/parens); rejects
 * anything else, including any non-+91 international number, ambiguous
 * short input, or non-numeric garbage.
 *
 * Server-controlled by design: the caller (a Server Action) always runs this
 * on the raw admin/CSV-supplied string itself — a client never gets to
 * supply a pre-normalized value directly (see create/update actions in
 * lib/actions/admin/users.ts, which only accept `mobile_number` — the raw
 * human input — and call this function themselves).
 */
export function normalizeMobileNumber(input: string): NormalizeMobileResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Mobile number is required.' }

  // Strip common formatting punctuation only — never digits, never '+'.
  const cleaned = trimmed.replace(/[\s\-().]/g, '')

  // Anything left that isn't optionally-one-leading-'+' followed by digits
  // is rejected outright (catches "abcdefghij", "++++919876543210", etc.)
  // before any prefix-stripping logic runs.
  if (!/^\+?[0-9]+$/.test(cleaned)) {
    return { ok: false, error: INVALID_MESSAGE }
  }

  let digits: string
  if (cleaned.startsWith('+')) {
    const rest = cleaned.slice(1)
    if (!rest.startsWith('91')) {
      // India-only for this stage — no country selector, no other country
      // code accepted. See this file's own top-of-file doc comment.
      return { ok: false, error: 'Only Indian mobile numbers are supported. Enter a 10-digit number (with or without a leading 0, 91, or +91).' }
    }
    digits = rest.slice(2)
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    digits = cleaned.slice(2)
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    digits = cleaned.slice(1)
  } else {
    digits = cleaned
  }

  if (!INDIA_MOBILE_REGEX.test(digits)) {
    return { ok: false, error: INVALID_MESSAGE }
  }

  return { ok: true, normalized: digits }
}
