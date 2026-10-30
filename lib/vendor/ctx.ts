import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { vendorRoleOf } from '@/lib/vendor/access'
import type { ProfileWithTeams, RequestStatus } from '@/types'

// Shared by the vendor's server actions: who is signed in, and is this ticket his. The ticket is read through the vendor's OWN login, so row security applies.

export type VendorTicket = { id: string; status: RequestStatus; assigned_to: string | null; requester_id: string; request_no: string; title: string }

export type VendorCtx = { profile: ProfileWithTeams; ticket: VendorTicket; supabase: Awaited<ReturnType<typeof createClient>> }

export const VENDOR_COMPANY_OFF_TEXT = 'The access of your company to Citykart Desk is switched off. Please contact Citykart.'

/**
 * False when the vendor company is switched off (Admin > Vendors > Switch off). A switched-off company's engineers can no longer open the vendor pages or act on tickets. A company
 * that cannot be read counts as off: a missing record must not mean "open to everyone".
 */
export async function vendorCompanyIsActive(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false
  const { data } = await (createAdminClient() as unknown as { from: (t: string) => any }).from('vendor_companies').select('is_active').eq('id', companyId).maybeSingle() // eslint-disable-line @typescript-eslint/no-explicit-any
  return data?.is_active === true
}

/** The signed-in vendor TECHNICIAN and one of his tickets, or an error text. */
export async function vendorTechAndTicket(requestId: string): Promise<VendorCtx | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (vendorRoleOf(profile) !== 'technician') return { error: 'Only a vendor technician can do this.' }
  if (!(await vendorCompanyIsActive(profile.vendor_company_id))) return { error: VENDOR_COMPANY_OFF_TEXT }
  const supabase = await createClient()
  const { data } = await supabase.from('requests').select('id, status, assigned_to, requester_id, request_no, title').eq('id', requestId).maybeSingle()
  const ticket = data as VendorTicket | null
  if (!ticket || ticket.assigned_to !== profile.id) return { error: 'This ticket is not assigned to you.' }
  return { profile, ticket, supabase }
}

export function refreshVendorPaths(requestId: string) {
  revalidatePath(`/vendor/tickets/${requestId}`)
  revalidatePath('/vendor')
  revalidatePath('/vendor/pos')
  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/purchase-orders')
}
