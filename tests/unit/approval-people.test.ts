import { describe, it, expect } from 'vitest'
import { approvalPeopleLine } from '@/lib/approvals/people'

type A = Parameters<typeof approvalPeopleLine>[0]
const step = (order: number, name: string | null, type = 'specific_user') => ({ step_order: order, approver_type: type, approver_user_id: name ? `u-${name}` : null, approver: name ? { id: `u-${name}`, full_name: name } : null })
const dec = (order: number, name: string, decision: 'approved' | 'rejected', at: string) => ({ step_order: order, decision, decider: { id: `u-${name}`, full_name: name }, decided_at: at })
const mk = (o: { status?: string; current_step?: number; steps: unknown[]; decisions?: unknown[] }) => ({ status: 'pending', current_step: 0, decisions: [], ...o }) as unknown as A

describe('names on an approval row', () => {
  it('pending, everyone asked at once: lists the people who have not answered', () => {
    const a = mk({ steps: [step(1, 'Ankur Pahwa'), step(2, 'Krishan')] })
    expect(approvalPeopleLine(a)).toMatchObject({ tone: 'pending', text: 'Awaiting: Ankur Pahwa and Krishan', allApprovers: ['Ankur Pahwa', 'Krishan'] })
    expect(approvalPeopleLine(mk({ steps: [step(1, 'A'), step(2, 'B'), step(3, 'C')] })).text).toBe('Awaiting: A, B and C')
  })

  it('pending, step by step: the person whose turn it is, which step, and who comes next', () => {
    const a = mk({ current_step: 1, steps: [step(1, 'Ankur Pahwa'), step(2, 'Krishan')] })
    expect(approvalPeopleLine(a).text).toBe('Awaiting: Ankur Pahwa (step 1 of 2), then Krishan')
    const b = mk({ current_step: 2, steps: [step(1, 'Ankur Pahwa'), step(2, 'Krishan')], decisions: [dec(1, 'Ankur Pahwa', 'approved', '2026-10-12T05:00:00Z')] as never })
    expect(approvalPeopleLine(b).text).toBe('Awaiting: Krishan (step 2 of 2)')
    expect(approvalPeopleLine(mk({ current_step: 1, steps: [step(1, null, 'any_manager')] })).text).toBe('Awaiting: any manager')
  })

  it('approved / rejected: who decided, and who was asked but not needed', () => {
    const steps = [step(1, 'Ankur Pahwa'), step(2, 'Krishan')]
    const approved = mk({ status: 'approved', steps, decisions: [dec(1, 'Ankur Pahwa', 'approved', '2026-10-12T05:00:00Z')] as never })
    expect(approvalPeopleLine(approved)).toMatchObject({ tone: 'approved', text: 'Approved by Ankur Pahwa · also asked: Krishan' })
    const rejected = mk({ status: 'rejected', steps, decisions: [dec(2, 'Krishan', 'rejected', '2026-10-12T05:00:00Z')] as never })
    expect(approvalPeopleLine(rejected)).toMatchObject({ tone: 'rejected', text: 'Rejected by Krishan · also asked: Ankur Pahwa' })
  })

  it('a step-by-step approval approved at every step names each approver', () => {
    const a = mk({ status: 'approved', current_step: 2, steps: [step(1, 'Ankur Pahwa'), step(2, 'Krishan')], decisions: [dec(1, 'Ankur Pahwa', 'approved', '2026-10-12T05:00:00Z'), dec(2, 'Krishan', 'approved', '2026-10-12T06:00:00Z')] as never })
    expect(approvalPeopleLine(a).text).toBe('Approved by Ankur Pahwa and Krishan')
  })

  it('says nothing for a cancelled approval, and never prints an empty name', () => {
    expect(approvalPeopleLine(mk({ status: 'cancelled', steps: [step(1, 'A')] })).text).toBe('')
    expect(approvalPeopleLine(mk({ steps: [step(1, null)] })).text).toBe('Awaiting: an approver')
  })
})
