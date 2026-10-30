// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { SLABadge } from '@/components/requests/SLABadge'
import { SLACountdownClocks } from '@/components/requests/SLACountdownClocks'
import { computeSLAState } from '@/lib/utils'

afterEach(() => cleanup())

const PAST = '2020-01-01T00:00:00Z'

// F-02 / D-02 / B-17 / E-16: a ticket whose SLA clock is stopped (waiting on the user, on a purchase from HO, on an approval) is never "breached", "overdue" or "at risk"
describe('a paused ticket shows "On hold" with the reason, never "SLA Breached"', () => {
  it.each([
    ['waiting_user', 'On Hold · Waiting on User'],
    ['hold_purchase_ho', 'On Hold · Purchase from HO'],
    ['pending_approval', 'On Hold · Pending Approval'],
  ] as const)('%s', (status, text) => {
    const { container } = render(<SLABadge resolutionDueAt={PAST} responseDueAt={null} status={status} showLabel />)
    expect(container.textContent).toBe(text)
    expect(container.textContent).not.toMatch(/breach/i)
  })

  it('an ordinary open ticket past its deadline still shows SLA Breached', () => {
    const { container } = render(<SLABadge resolutionDueAt={PAST} responseDueAt={null} status="in_progress" showLabel />)
    expect(container.textContent).toBe('SLA Breached')
  })

  it('computeSLAState gives "none" for every paused and every finished status', () => {
    for (const status of ['waiting_user', 'hold_purchase_ho', 'pending_approval', 'resolved', 'closed', 'cancelled'] as const) {
      expect(computeSLAState(PAST, status), status).toBe('none')
    }
    expect(computeSLAState(PAST, 'in_progress')).toBe('breached')
  })
})

describe('the countdown clocks stop for every paused status, including the purchase hold', () => {
  it.each(['waiting_user', 'hold_purchase_ho', 'pending_approval'] as const)('%s', (status) => {
    const { container } = render(
      <SLACountdownClocks responseDueAt={null} resolutionDueAt="2030-01-01T12:00:00Z" respondedAt={null} resolvedAt={null} status={status} waitingSince="2030-01-01T10:00:00Z" />
    )
    expect(container.textContent).toContain('(paused)')
    expect(container.textContent).toContain('2h 0m 0s remaining')
  })
})
