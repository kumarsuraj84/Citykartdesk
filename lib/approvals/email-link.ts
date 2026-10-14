// The "Approve / Reject" buttons in the approval e-mail. Each link belongs to ONE approver and ONE approval, works for LINK_DAYS days
// (or until the approval is decided, whichever is first: the page checks the live status) and then asks the approver to open the request
// in Citykart Desk instead. Opening it proves nothing about who is clicking, so the page asks the visitor to prove they are that
// approver: sign in as them, or enter the one-time 6-digit code that is e-mailed ONLY to the approver's own address (the code itself is
// random, kept hashed in the database and works once: lib/approvals/email-code.ts). The links are signed values, so they need no storage.

import { createHmac, randomInt, timingSafeEqual } from 'crypto'
const absoluteAppUrl = (path: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}${path}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How long a link works after the e-mail is sent. */
export const LINK_DAYS = 7
/** Links e-mailed before expiry existed carry no date; they work until this long after the approval was raised. */
export const LEGACY_LINK_DAYS = 14

// A dedicated secret is preferred; the older shared ones are still accepted so existing configuration keeps working.
function secret(): string | null {
  return process.env.APPROVAL_LINK_SECRET || process.env.CSAT_LINK_SECRET || process.env.CRON_SECRET || null
}
/** Links can only be made (and so the buttons shown) when a signing secret is configured. */
export const approvalLinksAvailable = () => secret() !== null

const sig = (key: string, purpose: string, payload: string) => createHmac('sha256', key).update(`${purpose}:${payload}`).digest('base64url')
const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/** Shown to anyone who is signed in as somebody else, e.g. the e-mail was forwarded. */
export const notAuthorisedMessage = (name: string) =>
  `You are not authorised to approve or reject this request. It can be approved or rejected only by ${name}, to whom it was sent.`

export const LINK_EXPIRED_MESSAGE = 'This link has expired. Please open the request in Citykart Desk to approve or reject it there.'

// ── the link ──

export function signApprovalToken(approvalId: string, approverId: string, now: number = Date.now()): string | null {
  const key = secret()
  if (!key || !UUID.test(approvalId) || !UUID.test(approverId)) return null
  const payload = `${approvalId}.${approverId}.${(now + LINK_DAYS * 86_400_000).toString(36)}`
  return `${payload}.${sig(key, 'approval-link-v2', payload)}`
}

export interface VerifiedLink {
  approvalId: string
  approverId: string
  /** When the link stops working (ms), or null for a link e-mailed before links expired. */
  expiresAt: number | null
  /** True for a dated link whose date has passed. */
  expired: boolean
}

export function verifyApprovalToken(token: string, now: number = Date.now()): VerifiedLink | null {
  const key = secret()
  const parts = (token ?? '').split('.')
  if (!key || (parts.length !== 3 && parts.length !== 4)) return null
  const [approvalId, approverId] = parts
  if (!UUID.test(approvalId) || !UUID.test(approverId)) return null
  const ids = { approvalId: approvalId.toLowerCase(), approverId: approverId.toLowerCase() }
  if (parts.length === 3) {
    // the old format: signed ids only, no date
    if (!same(parts[2], sig(key, 'approval-link', `${approvalId}.${approverId}`))) return null
    return { ...ids, expiresAt: null, expired: false }
  }
  const exp = parseInt(parts[2], 36)
  if (!Number.isFinite(exp) || !same(parts[3], sig(key, 'approval-link-v2', `${approvalId}.${approverId}.${parts[2]}`))) return null
  return { ...ids, expiresAt: exp, expired: exp <= now }
}

/** Is this link past its time? A dated link by its own date; an old undated one by the age of the approval. */
export function linkIsExpired(link: Pick<VerifiedLink, 'expiresAt' | 'expired'>, approvalCreatedAt: string | null | undefined, now: number = Date.now()): boolean {
  if (link.expiresAt !== null) return link.expired || link.expiresAt <= now
  const created = approvalCreatedAt ? Date.parse(approvalCreatedAt) : NaN
  return Number.isFinite(created) && created + LEGACY_LINK_DAYS * 86_400_000 <= now
}

export function approvalLinkUrls(approvalId: string, approverId: string): { pageUrl: string; approveUrl: string; rejectUrl: string } | null {
  const token = signApprovalToken(approvalId, approverId)
  if (!token) return null
  const pageUrl = absoluteAppUrl(`/approve/${token}`)
  return { pageUrl, approveUrl: `${pageUrl}?do=approve`, rejectUrl: `${pageUrl}?do=reject` }
}

// ── the 6-digit code (e-mailed to the approver only; random, single-use, stored hashed: lib/approvals/email-code.ts) ──

export const CODE_MINUTES = 10
export const CODE_MAX_ATTEMPTS = 5

export const newApprovalCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0')

/** Keyed hash of a code, bound to one approval and one approver, so a stored value is useless on its own. */
export function hashApprovalCode(approvalId: string, approverId: string, code: string): string {
  return createHmac('sha256', secret() ?? '').update(`approval-code:${approvalId}:${approverId}:${code}`).digest('hex')
}

export const normaliseCode = (code: string): string | null => {
  const given = (code ?? '').replace(/\s+/g, '')
  return /^\d{6}$/.test(given) ? given : null
}

export const codesEqual = (a: string, b: string) => same(a, b)

// ── "this browser proved it is the approver" (set after a correct code) ──

export const VERIFIED_MINUTES = 30
export const verifiedCookieName = (approvalId: string) => `ck-apv-${approvalId.replace(/-/g, '').slice(0, 12)}`

export function signVerified(approvalId: string, approverId: string, now: number = Date.now()): string | null {
  const key = secret()
  if (!key) return null
  const expires = now + VERIFIED_MINUTES * 60_000
  const payload = `${approverId}.${expires.toString(36)}`
  return `${payload}.${sig(key, `approval-verified:${approvalId}`, payload)}`
}

export function isVerified(value: string | undefined, approvalId: string, approverId: string, now: number = Date.now()): boolean {
  const key = secret()
  const parts = (value ?? '').split('.')
  if (!key || parts.length !== 3) return false
  const [who, exp, given] = parts
  if (who.toLowerCase() !== approverId.toLowerCase()) return false
  if (!same(given, sig(key, `approval-verified:${approvalId}`, `${who}.${exp}`))) return false
  const expires = parseInt(exp, 36)
  return Number.isFinite(expires) && expires > now
}
