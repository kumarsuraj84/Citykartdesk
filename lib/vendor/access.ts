import type { RequestStatus } from '@/types'

// Vendor logins: OEM engineers who work their own tickets in Citykart Desk.
//  - a vendor TECHNICIAN works the tickets assigned to him;
//  - a vendor MANAGER only looks (read only) at the tickets of the technicians of his own company.
// A vendor is an ordinary requester-level account (role 'user') that also carries a vendor company and a vendor kind (migration 177).

export type VendorRole = 'technician' | 'manager'

export type VendorProfileLike = { role?: string | null; vendor_company_id?: string | null; vendor_role?: string | null }

/** The vendor kind of this person, or null for everybody else (including a half-filled record, which is never trusted). */
export function vendorRoleOf(profile: VendorProfileLike | null | undefined): VendorRole | null {
  if (!profile || !profile.vendor_company_id) return null
  if (profile.role && profile.role !== 'user') return null
  return profile.vendor_role === 'technician' || profile.vendor_role === 'manager' ? profile.vendor_role : null
}

export const isVendor = (profile: VendorProfileLike | null | undefined): boolean => vendorRoleOf(profile) !== null

/** Pages a vendor may open. Anything else sends him back to his dashboard. */
const VENDOR_PREFIXES = ['/vendor', '/profile', '/notifications']

export function vendorMayOpen(pathname: string): boolean {
  return VENDOR_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** Where a vendor is sent from a page he may not open (a ticket link in an e-mail or notification lands on his own ticket page). */
export function vendorLandingFor(pathname: string): string {
  const m = /^\/requests\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname)
  return m ? `/vendor/tickets/${m[1]}` : '/vendor'
}

// ── The six boxes of the vendor dashboard ───────────────────────────────────────────────────────────────────────────────────────────

export type VendorBox = 'open' | 'in_process' | 'po_required' | 'part_required' | 'resolved' | 'cancelled'

export const VENDOR_BOX_ORDER: VendorBox[] = ['open', 'in_process', 'po_required', 'part_required', 'resolved', 'cancelled']

export const VENDOR_BOX_LABELS: Record<VendorBox, string> = {
  open: 'Open',
  in_process: 'In process',
  po_required: 'PO required from Citykart',
  part_required: 'Part required',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
}

/** What a vendor is waiting for while a ticket is on hold ('po' = purchase order, 'parts' = parts only). Comes from the ticket's pending vendor request. */
export type VendorHoldKind = 'po' | 'parts' | null

/**
 * The box a ticket is shown in. The boxes are only a way of grouping the existing ticket statuses (no status was added for vendors).
 * A hold with no recorded vendor request (someone put it on hold by hand) is shown under "In process": it is not waiting for anything the vendor can act on.
 */
export function vendorBoxOf(status: RequestStatus | string, holdKind: VendorHoldKind = null): VendorBox {
  switch (status) {
    case 'open':
    case 'assigned':
      return 'open'
    case 'hold_purchase_ho':
      return holdKind === 'po' ? 'po_required' : holdKind === 'parts' ? 'part_required' : 'in_process'
    case 'resolved':
    case 'closed':
      return 'resolved'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'in_process' // in_progress, waiting_user, pending_approval
  }
}

/** The statuses a box reads from (the list page asks the database for these). */
export const VENDOR_BOX_STATUSES: Record<VendorBox, RequestStatus[]> = {
  open: ['open', 'assigned'],
  in_process: ['in_progress', 'waiting_user', 'pending_approval'],
  po_required: ['hold_purchase_ho'],
  part_required: ['hold_purchase_ho'],
  resolved: ['resolved', 'closed'],
  cancelled: ['cancelled'],
}

export function isVendorBox(value: unknown): value is VendorBox {
  return typeof value === 'string' && (VENDOR_BOX_ORDER as string[]).includes(value)
}
