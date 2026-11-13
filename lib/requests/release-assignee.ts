// "Send back for routing": takes a ticket away from somebody who is no longer a technician (role changed, account switched off, account gone) so the
// Business Rules can give it to the right technician again.
//
// Why it is needed: a ticket keeps its technician in its own field. Changing a person's role or switching their account off changes only the person,
// never their tickets, so the tickets stayed with somebody who cannot work on them, and the routing rules never looked at them again
// (lib/automation/assign-rules.ts only acts on a ticket that has NO technician and is "open").
//
// This file only DECIDES what should happen to a ticket in a given status (it is pure, no database), so the rules can be tested on their own.
// lib/actions/admin/assignee-cleanup.ts does it and then runs the Business Rules.

import type { RequestStatus } from '@/types'

export type ReleaseAction =
  /** take the technician away; the ticket is already "open", so the rules can give it to somebody else */
  | 'clear'
  /** take the technician away AND put the ticket back to "open" (it was "assigned" or "in progress"), so the rules can give it to somebody else */
  | 'clear_and_reopen'
  /** take the technician away but KEEP the status: the ticket is waiting for the requester, an approval or a purchase, and that must not be thrown away.
   *  Such a ticket is NOT routed automatically - an administrator decides. */
  | 'clear_keep_status'
  /** nothing is done (the ticket is finished, or it has no technician anyway) */
  | 'skip'

export type ReleaseDecision = {
  action: ReleaseAction
  /** the status the ticket should have afterwards (the same one when it does not change) */
  newStatus: RequestStatus
  /** plain sentence for the administrator when the ticket needs their attention */
  warning?: string
  /** why nothing is done */
  skipReason?: string
}

const WAITING: Record<string, string> = {
  waiting_user: 'it is waiting for the requester',
  hold_purchase_ho: 'it is on hold for a purchase from head office',
  pending_approval: 'it is waiting for an approval',
}

/** What should happen to one ticket of a person who is no longer a technician. */
export function planRelease(status: RequestStatus | string, hasAssignee: boolean): ReleaseDecision {
  const s = String(status) as RequestStatus
  if (!hasAssignee) return { action: 'skip', newStatus: s, skipReason: 'the ticket has no technician.' }
  if (s === 'open') return { action: 'clear', newStatus: 'open' as RequestStatus }
  if (s === 'assigned' || s === 'in_progress') return { action: 'clear_and_reopen', newStatus: 'open' as RequestStatus }
  if (WAITING[s]) {
    return {
      action: 'clear_keep_status',
      newStatus: s,
      warning: `The technician was taken off, but the ticket keeps its status because ${WAITING[s]}. It is not given to anybody automatically - please choose a technician yourself.`,
    }
  }
  return { action: 'skip', newStatus: s, skipReason: 'the ticket is already finished.' }
}

/** Our own staff who may be given a ticket (the same rule the ticket screen uses when a ticket is assigned). */
const STAFF_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

export type TicketHolder = {
  role?: string | null
  is_active?: boolean | null
  /** set on a vendor technician / vendor manager: a plain "user" account linked to a vendor company */
  vendor_company_id?: string | null
}

/** True when this person may KEEP tickets: an active member of staff, or an active vendor technician (a vendor technician is a plain "user" account
 *  linked to a vendor company and works on that vendor's tickets, so their tickets must never be taken away by this clean-up). */
export function canHoldTickets(p: TicketHolder | null | undefined): boolean {
  if (!p) return false
  if (p.is_active === false) return false
  if (STAFF_ROLES.includes(String(p.role))) return true
  return !!p.vendor_company_id
}

/** True when a ticket may be GIVEN to this person. Stricter than keeping one: our own active staff only, like the ticket screen's own rule. */
export function canBeGivenTickets(p: TicketHolder | null | undefined): boolean {
  if (!p || p.is_active === false) return false
  return STAFF_ROLES.includes(String(p.role))
}

/** Why this person must not hold tickets any more, as one plain sentence, or null when they may. */
export function whyCannotHoldTickets(p: (TicketHolder & { full_name?: string | null }) | null | undefined): string | null {
  if (!p) return 'the account no longer exists'
  if (p.is_active === false) return 'the account is switched off'
  if (canHoldTickets(p)) return null
  return `the role is now "${p.role}"`
}

/** Does changing somebody to this role (or switching the account off) mean they can no longer hold tickets?
 *  A vendor technician keeps working on their vendor's tickets while the vendor link is there, so a move to "user" that keeps that link changes nothing. */
export function losesTicketRights(opts: { newRole?: string | null; newIsActive?: boolean | null; keepsVendorLink?: boolean }): boolean {
  if (opts.newIsActive === false) return true
  if (opts.newRole != null && !STAFF_ROLES.includes(String(opts.newRole))) return !opts.keepsVendorLink
  return false
}
