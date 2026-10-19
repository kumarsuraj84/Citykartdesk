import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The CVM of the requester's store, offered as the approver when a technician sends the ticket for approval (the technician can still change it).
 * Nothing is suggested when: the requester has no store, the store has no CVM, the CVM is no longer an active staff member, or the CVM is the requester or
 * the person sending (the approval rules never allow either of them to approve). Read-only; server-only.
 */
export async function suggestedCvmForRequest(p: { requesterId: string; orgId: string | null; viewerId: string }): Promise<{ id: string; full_name: string } | null> {
  if (!p.orgId) return null
  const admin = createAdminClient()
  const { data: requester } = await admin.from('profiles').select('store_id').eq('id', p.requesterId).eq('org_id', p.orgId).maybeSingle()
  if (!requester?.store_id) return null
  const { data: store } = await admin.from('stores').select('cvm_id').eq('id', requester.store_id).eq('org_id', p.orgId).maybeSingle()
  const cvmId = store?.cvm_id
  if (!cvmId || cvmId === p.requesterId || cvmId === p.viewerId) return null
  const { data: cvm } = await admin.from('profiles').select('id, full_name, is_active, role').eq('id', cvmId).eq('org_id', p.orgId).maybeSingle()
  if (!cvm || !cvm.is_active || !['agent', 'manager', 'admin', 'platform_owner'].includes(cvm.role)) return null
  return { id: cvm.id, full_name: cvm.full_name }
}
