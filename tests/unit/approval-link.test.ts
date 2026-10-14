import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import {
  CODE_MAX_ATTEMPTS, CODE_MINUTES, LEGACY_LINK_DAYS, LINK_DAYS, VERIFIED_MINUTES, approvalLinkUrls, hashApprovalCode, isVerified, linkIsExpired, newApprovalCode, normaliseCode,
  signApprovalToken, signVerified, verifiedCookieName, verifyApprovalToken,
} from '@/lib/approvals/email-link'
import { approvalRequiredEmail } from '@/lib/email/templates'

const A = '123e4567-e89b-12d3-a456-426614174000'
const P = '223e4567-e89b-12d3-a456-426614174111'
const Q = '323e4567-e89b-12d3-a456-426614174222'
const DAY = 86_400_000

beforeEach(() => {
  delete process.env.APPROVAL_LINK_SECRET; delete process.env.CRON_SECRET
  process.env.CSAT_LINK_SECRET = 'unit-secret'; process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
})

describe('the personal approval link', () => {
  const now = Date.UTC(2026, 9, 12, 10, 0, 0)

  it('round-trips, names one approver and carries its own expiry', () => {
    const t = signApprovalToken(A, P, now)!
    expect(verifyApprovalToken(t, now)).toEqual({ approvalId: A, approverId: P, expiresAt: now + LINK_DAYS * DAY, expired: false })
    const urls = approvalLinkUrls(A, P)!
    expect(urls.pageUrl).toMatch(/^http:\/\/app\.test\/approve\//)
    expect(urls.approveUrl.endsWith('?do=approve')).toBe(true)
    expect(urls.rejectUrl.endsWith('?do=reject')).toBe(true)
  })

  it('stops working after LINK_DAYS days, but is still recognised as an (expired) link', () => {
    const t = signApprovalToken(A, P, now)!
    expect(verifyApprovalToken(t, now + (LINK_DAYS - 1) * DAY)?.expired).toBe(false)
    expect(verifyApprovalToken(t, now + LINK_DAYS * DAY + 1)?.expired).toBe(true)
    expect(linkIsExpired(verifyApprovalToken(t, now + 8 * DAY)!, null, now + 8 * DAY)).toBe(true)
    expect(linkIsExpired(verifyApprovalToken(t, now)!, null, now)).toBe(false)
  })

  it('refuses a link that was edited (another approver, another approval, a later date) or signed with another secret', () => {
    const t = signApprovalToken(A, P, now)!
    const [, , exp, sig] = t.split('.')
    expect(verifyApprovalToken(`${A}.${Q}.${exp}.${sig}`, now)).toBeNull() // swap in a different approver
    expect(verifyApprovalToken(`${Q}.${P}.${exp}.${sig}`, now)).toBeNull() // swap in a different approval
    expect(verifyApprovalToken(`${A}.${P}.${(parseInt(exp, 36) + 10 * DAY).toString(36)}.${sig}`, now)).toBeNull() // push the expiry out
    expect(verifyApprovalToken('nonsense', now)).toBeNull()
    process.env.CSAT_LINK_SECRET = 'other'
    expect(verifyApprovalToken(t, now)).toBeNull()
  })

  it('uses a dedicated approval secret when there is one, in preference to the shared ones', () => {
    process.env.APPROVAL_LINK_SECRET = 'dedicated-secret'
    const t = signApprovalToken(A, P, now)!
    expect(verifyApprovalToken(t, now)).not.toBeNull()
    delete process.env.APPROVAL_LINK_SECRET
    expect(verifyApprovalToken(t, now)).toBeNull() // it was signed with the dedicated secret, not the shared one
  })

  it('still accepts a link e-mailed before links expired, until the approval is LEGACY_LINK_DAYS old', () => {
    const payload = `${A}.${P}`
    const legacy = `${payload}.${createHmac('sha256', 'unit-secret').update(`approval-link:${payload}`).digest('base64url')}`
    const v = verifyApprovalToken(legacy, now)!
    expect(v).toEqual({ approvalId: A, approverId: P, expiresAt: null, expired: false })
    const raised = new Date(now - 2 * DAY).toISOString()
    expect(linkIsExpired(v, raised, now)).toBe(false)
    expect(linkIsExpired(v, raised, now + (LEGACY_LINK_DAYS - 1) * DAY)).toBe(true) // 2 + 13 days
    expect(linkIsExpired(v, raised, now + (LEGACY_LINK_DAYS - 3) * DAY)).toBe(false)
    expect(linkIsExpired(v, null, now)).toBe(false) // no date known: not guessed
  })

  it('makes no link when no secret is configured', () => {
    delete process.env.CSAT_LINK_SECRET
    expect(signApprovalToken(A, P)).toBeNull()
    expect(approvalLinkUrls(A, P)).toBeNull()
  })
})

describe('the 6-digit code', () => {
  it('is six digits and random', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) { const c = newApprovalCode(); expect(c).toMatch(/^\d{6}$/); seen.add(c) }
    expect(seen.size).toBeGreaterThan(30)
    expect(CODE_MINUTES).toBe(10)
    expect(CODE_MAX_ATTEMPTS).toBe(5)
  })

  it('is stored only as a hash that belongs to one approver on one approval', () => {
    const h = hashApprovalCode(A, P, '123456')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('123456')
    expect(hashApprovalCode(A, P, '123456')).toBe(h)
    expect(hashApprovalCode(A, Q, '123456')).not.toBe(h) // another approver
    expect(hashApprovalCode(Q, P, '123456')).not.toBe(h) // another approval
    expect(hashApprovalCode(A, P, '123457')).not.toBe(h)
  })

  it('accepts spaces typed in and refuses anything that is not six digits', () => {
    expect(normaliseCode(' 123 456 ')).toBe('123456')
    for (const bad of ['', '12345', '1234567', 'abcdef', '000000x']) expect(normaliseCode(bad)).toBeNull()
  })
})

describe('"this browser proved it is the approver"', () => {
  const now = Date.UTC(2026, 9, 12, 10, 0, 0)
  it('holds for 30 minutes for that approver and that approval only', () => {
    const v = signVerified(A, P, now)!
    expect(isVerified(v, A, P, now + 60_000)).toBe(true)
    expect(isVerified(v, A, P, now + (VERIFIED_MINUTES + 1) * 60_000)).toBe(false)
    expect(isVerified(v, A, Q, now + 60_000)).toBe(false) // someone else's link
    expect(isVerified(v, Q, P, now + 60_000)).toBe(false) // another approval
    expect(isVerified(undefined, A, P, now)).toBe(false)
    expect(isVerified(v.slice(0, -2) + 'xx', A, P, now + 60_000)).toBe(false)
    expect(verifiedCookieName(A)).toBe('ck-apv-123e4567e89b')
  })
})

describe('the buttons in the e-mail', () => {
  const base = { approverName: 'Ankur', requestTitle: 'CKSD-000140 - HP printer', requestUrl: 'http://app.test/requests/1', requesterName: 'LMD', senderName: 'Kaushlesh' }
  it('show Approve and Reject with a note that only the approver can decide, and how long they work', () => {
    const m = approvalRequiredEmail({ ...base, approveUrl: 'http://app.test/approve/t?do=approve', rejectUrl: 'http://app.test/approve/t?do=reject' })
    expect(m.html).toContain('href="http://app.test/approve/t?do=approve"')
    expect(m.html).toContain('href="http://app.test/approve/t?do=reject"')
    expect(m.html).toContain('>Approve<')
    expect(m.html).toContain('>Reject<')
    expect(m.html).toContain('A comment is required')
    expect(m.html).toContain('Only <strong>Ankur</strong> can decide')
    expect(m.html).toContain(`The buttons work for ${LINK_DAYS} days`)
    expect(m.text).toContain('Approve: http://app.test/approve/t?do=approve')
    expect(m.text).toContain('Reject: http://app.test/approve/t?do=reject')
    expect(m.text).toContain(`The links work for ${LINK_DAYS} days`)
  })
  it('keep the single "Review & Approve" button when there is no link', () => {
    const m = approvalRequiredEmail(base)
    expect(m.html).toContain('Review & Approve')
    expect(m.html).not.toContain('>Reject<')
  })
})
