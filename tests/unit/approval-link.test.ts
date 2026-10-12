import { describe, it, expect, beforeEach } from 'vitest'
import {
  CODE_WINDOW_MS, VERIFIED_MINUTES, approvalCode, approvalLinkUrls, codeMatches, isVerified, signApprovalToken, signVerified, verifiedCookieName, verifyApprovalToken,
} from '@/lib/approvals/email-link'
import { approvalRequiredEmail } from '@/lib/email/templates'

const A = '123e4567-e89b-12d3-a456-426614174000'
const P = '223e4567-e89b-12d3-a456-426614174111'
const Q = '323e4567-e89b-12d3-a456-426614174222'

beforeEach(() => { process.env.CSAT_LINK_SECRET = 'unit-secret'; process.env.NEXT_PUBLIC_APP_URL = 'http://app.test' })

describe('the personal approval link', () => {
  it('round-trips, never expires by itself, and names one approver', () => {
    const t = signApprovalToken(A, P)!
    expect(verifyApprovalToken(t)).toEqual({ approvalId: A, approverId: P })
    expect(approvalLinkUrls(A, P)).toMatchObject({ pageUrl: `http://app.test/approve/${t}`, approveUrl: `http://app.test/approve/${t}?do=approve`, rejectUrl: `http://app.test/approve/${t}?do=reject` })
  })

  it('refuses a link that was edited (another approver, another approval) or signed with another secret', () => {
    const t = signApprovalToken(A, P)!
    const [, , sig] = t.split('.')
    expect(verifyApprovalToken(`${A}.${Q}.${sig}`)).toBeNull() // swap in a different approver
    expect(verifyApprovalToken(`${Q}.${P}.${sig}`)).toBeNull() // swap in a different approval
    expect(verifyApprovalToken('nonsense')).toBeNull()
    process.env.CSAT_LINK_SECRET = 'other'
    expect(verifyApprovalToken(t)).toBeNull()
  })

  it('makes no link when no secret is configured', () => {
    const keep = process.env.CRON_SECRET
    delete process.env.CSAT_LINK_SECRET; delete process.env.CRON_SECRET
    expect(signApprovalToken(A, P)).toBeNull()
    expect(approvalLinkUrls(A, P)).toBeNull()
    if (keep) process.env.CRON_SECRET = keep
  })
})

describe('the 6-digit code', () => {
  const now = Date.UTC(2026, 9, 12, 10, 0, 0)

  it('is six digits, accepted for 10 to 15 minutes, then refused', () => {
    const code = approvalCode(A, P, now)
    expect(code).toMatch(/^\d{6}$/)
    expect(codeMatches(A, P, code, now)).toBe(true)
    expect(codeMatches(A, P, code, now + CODE_WINDOW_MS)).toBe(true)
    expect(codeMatches(A, P, code, now + 2 * CODE_WINDOW_MS)).toBe(true)
    expect(codeMatches(A, P, code, now + 3 * CODE_WINDOW_MS)).toBe(false)
    expect(codeMatches(A, P, ` ${code.slice(0, 3)} ${code.slice(3)} `, now)).toBe(true) // spaces typed in are fine
  })

  it('belongs to one approver on one approval, and rubbish is refused', () => {
    const code = approvalCode(A, P, now)
    expect(codeMatches(A, Q, code, now)).toBe(false) // another approver
    expect(codeMatches(Q, P, code, now)).toBe(false) // another approval
    for (const bad of ['', '12345', '1234567', 'abcdef', '000000x']) expect(codeMatches(A, P, bad, now)).toBe(false)
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
  it('show Approve and Reject with a note that only the approver can decide', () => {
    const m = approvalRequiredEmail({ ...base, approveUrl: 'http://app.test/approve/t?do=approve', rejectUrl: 'http://app.test/approve/t?do=reject' })
    expect(m.html).toContain('href="http://app.test/approve/t?do=approve"')
    expect(m.html).toContain('href="http://app.test/approve/t?do=reject"')
    expect(m.html).toContain('>Approve<')
    expect(m.html).toContain('>Reject<')
    expect(m.html).toContain('A comment is required')
    expect(m.html).toContain('Only <strong>Ankur</strong> can decide')
    expect(m.text).toContain('Approve: http://app.test/approve/t?do=approve')
    expect(m.text).toContain('Reject: http://app.test/approve/t?do=reject')
  })
  it('keep the single "Review & Approve" button when there is no link', () => {
    const m = approvalRequiredEmail(base)
    expect(m.html).toContain('Review & Approve')
    expect(m.html).not.toContain('>Reject<')
  })
})
