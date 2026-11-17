import { describe, expect, it } from 'vitest'
import { approvalAction, approverEmail } from '@/lib/zoho/transfer/approval'
import { atOfRaw, describeRaw, whoOfRaw } from '@/lib/zoho/transfer/data-pure'

describe('what a Zoho approval line means', () => {
  it('knows sent for approval, approved and rejected', () => {
    expect(approvalAction('approval — Sent for approval to Regional Manager')).toBe('approval_requested')
    expect(approvalAction('Approval request initiated by technician')).toBe('approval_requested')
    expect(approvalAction('approval — Approved by Regional Manager: ok to proceed')).toBe('approved')
    expect(approvalAction('Request was rejected by the approver')).toBe('rejected')
    expect(approvalAction('Approval denied')).toBe('rejected')
  })
  it('reads the lines exactly as the real Zoho copy writes them', () => {
    expect(approvalAction('approver_added — Stage I  Approver Added : anshul.jain@citykartstores.com')).toBeNull()
    expect(approvalAction('req_approval — Approval mail sent to anshul.jain@citykartstores.com In Stage I')).toBe('approval_requested')
    expect(approvalAction('approve — Approved By : anshul.jain@citykartstores.com In Stage I Approval Comments : ok')).toBe('approved')
    expect(approvalAction('approval_status_change — Approval Status modified from Pending Approval to Approved')).toBeNull()
    expect(approverEmail('Approved By : Anshul.Jain@citykartstores.com In Stage I')).toBe('anshul.jain@citykartstores.com')
    expect(approverEmail('no address here')).toBeNull()
  })
  it('says nothing for a line that is not about approval, and never guesses', () => {
    expect(approvalAction('update — Assigned to Ravi')).toBeNull()
    expect(approvalAction('')).toBeNull()
    expect(approvalAction(null)).toBeNull()
  })
})

describe('reading a Zoho record we have no fixed layout for', () => {
  const text = (h: string) => h.replace(/<[^>]+>/g, '')
  it('finds who did it and when, in Zoho\'s own shapes', () => {
    expect(whoOfRaw({ created_by: { name: 'Ravi Kumar' } })).toBe('Ravi Kumar')
    expect(whoOfRaw({ owner: { name: 'Asha' } })).toBe('Asha')
    expect(whoOfRaw({})).toBeNull()
    expect(atOfRaw({ created_time: { value: '1794000000000' } })).toBe(new Date(1794000000000).toISOString())
    expect(atOfRaw({ created_at: '2026-03-04T10:00:00Z' })).toBe('2026-03-04T10:00:00.000Z')
    expect(atOfRaw({ nothing: 1 })).toBeNull()
  })
  it('shows every readable field, strips html, and drops the empty ones', () => {
    const out = describeRaw({ title: 'Replace capacitor', description: '<p>Done <b>today</b></p>', status: { name: 'Open' }, empty: '', nope: null }, text)
    expect(out).toContain('title: Replace capacitor')
    expect(out).toContain('description: Done today')
    expect(out).toContain('status: Open')
    expect(out).not.toContain('empty')
  })
})
