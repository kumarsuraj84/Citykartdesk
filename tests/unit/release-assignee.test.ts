/**
 * "Send back for routing" — what happens to a ticket whose technician may no longer hold tickets
 * (lib/requests/release-assignee.ts). The decision per status must match what the ticket screen's own
 * unassign does (B-10 / B-12: a ticket that loses its owner while "assigned" or "in progress" goes back to "open").
 */
import { describe, it, expect } from 'vitest'
import { planRelease, canHoldTickets, canBeGivenTickets, whyCannotHoldTickets, losesTicketRights } from '@/lib/requests/release-assignee'
import type { RequestStatus } from '@/types'

const s = (x: string) => x as RequestStatus

describe('planRelease', () => {
  it('an open ticket only loses its technician, so the rules can route it', () => {
    expect(planRelease(s('open'), true)).toEqual({ action: 'clear', newStatus: 'open' })
  })

  it('an assigned or in-progress ticket goes back to open as well', () => {
    for (const st of ['assigned', 'in_progress']) {
      const d = planRelease(s(st), true)
      expect(d.action).toBe('clear_and_reopen')
      expect(d.newStatus).toBe('open')
    }
  })

  it('a ticket that is waiting keeps its status and warns the administrator', () => {
    for (const st of ['waiting_user', 'hold_purchase_ho', 'pending_approval']) {
      const d = planRelease(s(st), true)
      expect(d.action).toBe('clear_keep_status')
      expect(d.newStatus).toBe(st)
      expect(d.warning).toBeTruthy()
    }
  })

  it('a finished ticket is never touched', () => {
    for (const st of ['resolved', 'closed', 'cancelled']) {
      expect(planRelease(s(st), true).action).toBe('skip')
    }
  })

  it('a ticket with no technician is left alone', () => {
    expect(planRelease(s('open'), false).action).toBe('skip')
  })
})

describe('who may hold tickets', () => {
  it('an active technician, manager, administrator or platform owner may', () => {
    for (const role of ['agent', 'manager', 'admin', 'platform_owner']) {
      expect(canHoldTickets({ role, is_active: true })).toBe(true)
      expect(whyCannotHoldTickets({ role, is_active: true })).toBeNull()
    }
  })

  // A vendor technician is a plain "user" account linked to a vendor company and works on that vendor's tickets. Treating them as "not a technician"
  // would take every vendor ticket away from its vendor - found while trying this on the local copy, where 6 vendor technicians hold 14 tickets.
  it('a vendor technician keeps their tickets, even though the role is "user"', () => {
    const vendorTech = { role: 'user', is_active: true, vendor_company_id: 'voltas-id' }
    expect(canHoldTickets(vendorTech)).toBe(true)
    expect(whyCannotHoldTickets(vendorTech)).toBeNull()
  })

  it('a switched-off vendor technician may not', () => {
    expect(canHoldTickets({ role: 'user', is_active: false, vendor_company_id: 'voltas-id' })).toBe(false)
  })

  it('a requester, a switched-off account and a missing account may not', () => {
    expect(canHoldTickets({ role: 'user', is_active: true })).toBe(false)
    expect(whyCannotHoldTickets({ role: 'user', is_active: true })).toBe('the role is now "user"')
    expect(canHoldTickets({ role: 'agent', is_active: false })).toBe(false)
    expect(whyCannotHoldTickets({ role: 'agent', is_active: false })).toBe('the account is switched off')
    expect(canHoldTickets(null)).toBe(false)
    expect(whyCannotHoldTickets(null)).toBe('the account no longer exists')
  })

  it('a ticket may only be GIVEN to our own active staff, never to a vendor technician', () => {
    expect(canBeGivenTickets({ role: 'agent', is_active: true })).toBe(true)
    expect(canBeGivenTickets({ role: 'user', is_active: true, vendor_company_id: 'voltas-id' })).toBe(false)
    expect(canBeGivenTickets({ role: 'agent', is_active: false })).toBe(false)
  })
})

describe('which changes take the right away', () => {
  it('switching the account off always does', () => {
    expect(losesTicketRights({ newIsActive: false })).toBe(true)
  })

  it('a move to "user" does, a move between technician roles does not', () => {
    expect(losesTicketRights({ newRole: 'user' })).toBe(true)
    expect(losesTicketRights({ newRole: 'agent' })).toBe(false)
    expect(losesTicketRights({ newRole: 'manager' })).toBe(false)
    expect(losesTicketRights({ newRole: 'admin' })).toBe(false)
  })

  it('a vendor technician who stays a "user" keeps their vendor link, so nothing is taken away', () => {
    expect(losesTicketRights({ newRole: 'user', keepsVendorLink: true })).toBe(false)
  })

  it('reactivating an account does not', () => {
    expect(losesTicketRights({ newIsActive: true })).toBe(false)
  })
})
