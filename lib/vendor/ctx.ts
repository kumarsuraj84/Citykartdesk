import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { vendorRoleOf } from '@/lib/vendor/access'
import type { ProfileWithTeams, RequestStatus } from '@/types'

// Shared by the vendor's server actions: who is signed in, and is this ticket his. The ticket is read through the vendor's OWN login, so row security applies.

export type VendorTicket = { id: string; status: RequestStatus; assigned_to: string | null; requester_id: string; request_no: string; title: string }

export type VendorCtx = { profile: ProfileWithTeams; ticket: VendorTicket; supabase: Awaited<ReturnType<typeof createClient>> }

/** The signed-in vendor TECHNICIAN and one of his tickets, or an error text. */
export async function vendorTechAndTicket(requestId: string): Promise<VendorCtx | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (vendorRoleOf(profile) !== 'technician') return { error: 'Only a vendor technician can do this.' }
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
