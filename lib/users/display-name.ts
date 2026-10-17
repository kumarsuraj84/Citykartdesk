// What a person may use as their display name (VAPT-061 / VA-DB-10). The name appears next to approvals, comments and history, so it must not be able to
// impersonate another person, hide text with invisible or direction-changing characters, or carry markup.

export const NAME_MIN = 2
export const NAME_MAX = 80

export type NameCheck = { ok: true; name: string } | { ok: false; error: string }

// letters (any language), combining marks, digits, space and a few punctuation marks used in real names and store logins
const ALLOWED = /^[\p{L}\p{M}\p{N} .'’\-_&()/,#]+$/u
// zero-width and direction-control characters, and other invisible formatting
const INVISIBLE = /[​-‏‪-‮⁠-⁯﻿­]/u

export function checkDisplayName(raw: string): NameCheck {
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (name.length < NAME_MIN) return { ok: false, error: `Full name must be at least ${NAME_MIN} characters.` }
  if (name.length > NAME_MAX) return { ok: false, error: `Full name can be at most ${NAME_MAX} characters.` }
  if (INVISIBLE.test(name) || !ALLOWED.test(name)) return { ok: false, error: 'Full name can contain letters, digits, spaces and . \' - _ & ( ) / , # only.' }
  return { ok: true, name }
}

/** Comparison form of a name: case, accents and spacing ignored. */
export function nameKey(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
}
