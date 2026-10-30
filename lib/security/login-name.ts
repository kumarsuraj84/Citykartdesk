// What may be written to the audit trail about a sign-in attempt (audit A-16). People sometimes type their PASSWORD into the e-mail box; the audit trail is
// append-only and hash-chained, so whatever is written there stays for years. A value that does not look like an e-mail address is therefore never stored
// as typed: only a short one-way fingerprint (enough to tell "the same thing was tried again" without being the secret).
import { createHash } from 'node:crypto'

const EMAIL_SHAPE = /^[^\s@<>"'`,;:\()[\]]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/

export function redactLoginName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return '(empty)'
  if (s.length <= 254 && EMAIL_SHAPE.test(s)) return s.toLowerCase()
  return `(not an e-mail address, fingerprint ${createHash('sha256').update(s).digest('hex').slice(0, 10)})`
}
