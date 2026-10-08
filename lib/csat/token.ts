// The signed link in a CSAT e-mail. It names one survey and stops working after a set time, and it cannot be guessed or
// edited: the last part is an HMAC of the first two. The link (not a password) is what proves "this is the requester",
// which is how store users who share a mailbox can rate or reopen without logging in.

import { createHmac, timingSafeEqual } from 'crypto'

/** How long after resolving a ticket its e-mail link keeps working (rating only after the reopen window ends). */
export const CSAT_LINK_DAYS = 30

function secret(): string | null {
  return process.env.CSAT_LINK_SECRET || process.env.CRON_SECRET || null
}

/** Links can only be made (and so the e-mail sent) when a signing secret is configured. */
export const csatLinksAvailable = () => secret() !== null

const sig = (key: string, payload: string) => createHmac('sha256', key).update(payload).digest('base64url')

export function signCsatToken(surveyId: string, expiresAtMs: number): string | null {
  const key = secret()
  if (!key) return null
  const payload = `${surveyId}.${Math.floor(expiresAtMs).toString(36)}`
  return `${payload}.${sig(key, payload)}`
}

export type TokenCheck = { ok: true; surveyId: string; expiresAt: number } | { ok: false; reason: 'invalid' | 'expired' }

export function verifyCsatToken(token: string, now = Date.now()): TokenCheck {
  const key = secret()
  const parts = token.split('.')
  if (!key || parts.length !== 3) return { ok: false, reason: 'invalid' }
  const [surveyId, expRaw, given] = parts
  const expected = sig(key, `${surveyId}.${expRaw}`)
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' }
  const expiresAt = parseInt(expRaw, 36)
  if (!Number.isFinite(expiresAt) || !/^[0-9a-f-]{36}$/i.test(surveyId)) return { ok: false, reason: 'invalid' }
  if (expiresAt < now) return { ok: false, reason: 'expired' }
  return { ok: true, surveyId, expiresAt }
}
