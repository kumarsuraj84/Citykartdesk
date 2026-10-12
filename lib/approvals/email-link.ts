// The "Approve / Reject" buttons in the approval e-mail. Each link belongs to ONE approver and ONE approval and has no expiry: it
// works until the approval is decided (the page checks the live status). Opening it proves nothing about who is clicking, so the
// page asks the visitor to prove they are that approver: sign in as them, or enter the 6-digit code that is e-mailed ONLY to the
// approver's own address. Everything here is stateless (signed values), so no database change is needed.

import { createHmac, timingSafeEqual } from 'crypto'
const absoluteAppUrl = (path: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}${path}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function secret(): string | null {
  return process.env.CSAT_LINK_SECRET || process.env.CRON_SECRET || null
}
/** Links can only be made (and so the buttons shown) when a signing secret is configured. */
export const approvalLinksAvailable = () => secret() !== null

const sig = (key: string, purpose: string, payload: string) => createHmac('sha256', key).update(`${purpose}:${payload}`).digest('base64url')
const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/** Shown to anyone who is signed in as somebody else, e.g. the e-mail was forwarded. */
export const notAuthorisedMessage = (name: string) =>
  `You are not authorised to approve or reject this request. It can be approved or rejected only by ${name}, to whom it was sent.`

// ── the link ──

export function signApprovalToken(approvalId: string, approverId: string): string | null {
  const key = secret()
  if (!key || !UUID.test(approvalId) || !UUID.test(approverId)) return null
  const payload = `${approvalId}.${approverId}`
  return `${payload}.${sig(key, 'approval-link', payload)}`
}

export function verifyApprovalToken(token: string): { approvalId: string; approverId: string } | null {
  const key = secret()
  const parts = (token ?? '').split('.')
  if (!key || parts.length !== 3) return null
  const [approvalId, approverId, given] = parts
  if (!UUID.test(approvalId) || !UUID.test(approverId)) return null
  if (!same(given, sig(key, 'approval-link', `${approvalId}.${approverId}`))) return null
  return { approvalId: approvalId.toLowerCase(), approverId: approverId.toLowerCase() }
}

export function approvalLinkUrls(approvalId: string, approverId: string): { pageUrl: string; approveUrl: string; rejectUrl: string } | null {
  const token = signApprovalToken(approvalId, approverId)
  if (!token) return null
  const pageUrl = absoluteAppUrl(`/approve/${token}`)
  return { pageUrl, approveUrl: `${pageUrl}?do=approve`, rejectUrl: `${pageUrl}?do=reject` }
}

// ── the 6-digit code (e-mailed to the approver only) ──

export const CODE_WINDOW_MS = 5 * 60_000
/** A code is accepted for its own 5-minute window and the two before it: 10 to 15 minutes in all. */
const CODE_WINDOWS_ACCEPTED = 3

export function approvalCode(approvalId: string, approverId: string, at: number = Date.now()): string {
  const key = secret() ?? ''
  const window = Math.floor(at / CODE_WINDOW_MS)
  const digest = createHmac('sha256', key).update(`approval-code:${approvalId}:${approverId}:${window}`).digest()
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

export function codeMatches(approvalId: string, approverId: string, code: string, now: number = Date.now()): boolean {
  const given = (code ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(given) || !secret()) return false
  let ok = false
  for (let i = 0; i < CODE_WINDOWS_ACCEPTED; i++) {
    if (same(given, approvalCode(approvalId, approverId, now - i * CODE_WINDOW_MS))) ok = true // no early exit: same timing either way
  }
  return ok
}

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
