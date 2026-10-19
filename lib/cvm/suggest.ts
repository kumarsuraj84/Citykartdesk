import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCvmEmail } from '@/lib/masters/resolve'
import { loadCvmCandidates } from './load'

/**
 * The CVM of the requester's store (from the CVM Google Sheet), offered as the approver when a technician sends the ticket for approval (the technician can
 * still change it). Nothing is suggested when: the requester has no store, the sheet has no CVM for the store, the CVM's e-mail is not an active staff member
 * of CK Desk, or the CVM is the requester or the person sending (the approval rules never allow either of them to approve). Read-only; server-only.
 */
export async function suggestedCvmForRequest(p: { requesterId: string; orgId: string | null; viewerId: string }): Promise<{ id: string; full_name: string } | null> {
  if (!p.orgId) return null
  const admin = createAdminClient()
  const { data: requester } = await admin.from('profiles').select('store_id').eq('id', p.requesterId).eq('org_id', p.orgId).maybeSingle()
  if (!requester?.store_id) return null
  const { data: store } = await admin.from('stores').select('code').eq('id', requester.store_id).eq('org_id', p.orgId).maybeSingle()
  if (!store?.code) return null
  const email = await loadCvmEmail(admin as never, p.orgId, String(store.code))
  if (!email) return null
  const candidates = await loadCvmCandidates(p.orgId)
  const cvmId = candidates.byEmail.get(email.toLowerCase())
  if (!cvmId || cvmId === p.requesterId || cvmId === p.viewerId) return null
  const { data: cvm } = await admin.from('profiles').select('id, full_name').eq('id', cvmId).eq('org_id', p.orgId).maybeSingle()
  return cvm ? { id: cvm.id, full_name: cvm.full_name } : null
}
