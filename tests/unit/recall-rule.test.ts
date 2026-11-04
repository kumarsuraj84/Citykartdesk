import { describe, it, expect } from 'vitest'
import { mayRecallApproval } from '@/lib/approvals/recall-rule'

describe('who may recall a pending approval', () => {
  it('managers, admins and platform owners may recall any', () => {
    for (const role of ['manager', 'admin', 'platform_owner']) expect(mayRecallApproval(role, 'me', 'someone-else')).toBe(true)
  })
  it('a technician only the approval he sent himself', () => {
    expect(mayRecallApproval('agent', 'me', 'me')).toBe(true)
    expect(mayRecallApproval('agent', 'me', 'someone-else')).toBe(false)
    expect(mayRecallApproval('agent', 'me', null)).toBe(false)
    expect(mayRecallApproval('agent', 'me', undefined)).toBe(false)
  })
  it('a requester (or anyone else) never', () => {
    expect(mayRecallApproval('user', 'me', 'me')).toBe(false)
  })
})
