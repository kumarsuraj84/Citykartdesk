import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { createAdHocApproval } from '@/lib/approvals/adhoc'
import { firstBarredApprover } from '@/lib/approvals/separation'

type Db = ReturnType<typeof createAdminClient>

/**
 * Automatic approval by the store's CVM, for a category that asks for it (for example Fixture, Hangers, Fixture Attachments):
 *   1. the ticket goes In Process by itself;
 *   2. it is sent for approval to the CVM of the requester's store (the first decision is final, like any approval) and so waits in Pending Approval,
 *      the clock paused;
 *   3. when the CVM approves, the normal approval flow puts it back to In Process (a rejection cancels it with the CVM's reason).
 * When the store has no usable CVM (none tagged, inactive, not staff, or the requester themself) the ticket is left Open with an internal note so a
 * technician sends it by hand. Never throws: the ticket already exists and must not be lost because of this.
 */
export async function runAutoCvmApproval(p: {
  admin: Db
  orgId: string
  request: { id: string; request_no: string | null; title: string }
  requesterId: string
  actorId: string
  hasStore: boolean
  storeCvmId: string | null
  /** The address the CVM sheet lists for the store (null = the store is not in the sheet). Only used to word the note when no CVM could be found. */
  cvmEmailInSheet?: string | null
}): Promise<void> {
  const { admin } = p
  const note = async (body: string, internal = true) => {
    await admin.from('request_comments').insert({ request_id: p.request.id, author_id: p.actorId, body, is_internal: internal })
  }
  try {
    const stop = async (why: string) => note(why)
    if (!p.hasStore) return await stop('This requester is not linked to a store, so the ticket was not sent to a CVM for approval automatically. Please send it for approval yourself.')
    if (!p.storeCvmId) {
      return await stop(p.cvmEmailInSheet
        ? `The CVM listed for this store (${p.cvmEmailInSheet}) is not an active staff member in CK Desk, so the ticket was not sent for approval automatically. Please send it for approval yourself.`
        : 'No CVM is listed for this store in the CVM sheet, so the ticket was not sent for approval automatically. Please send it for approval yourself.')
    }
    const barred = firstBarredApprover([p.storeCvmId], { requesterId: p.requesterId, senderId: p.actorId })
    if (barred) return await stop('The CVM of this store is the requester, who cannot approve their own request, so the ticket was not sent for approval automatically. Please send it for approval yourself.')

    const { data: cvm } = await admin.from('profiles').select('id, full_name, is_active, role').eq('id', p.storeCvmId).eq('org_id', p.orgId).maybeSingle()
    if (!cvm || !cvm.is_active || !['agent', 'manager', 'admin', 'platform_owner'].includes(cvm.role)) {
      return await stop('The CVM tagged to this store is no longer an active staff member, so the ticket was not sent for approval automatically. Please send it for approval yourself.')
    }

    // 1. In Process by itself (conditioned on Open: a Business Rule may already have moved it)
    const nowIso = new Date().toISOString()
    const { data: moved } = await admin.from('requests').update({ status: 'in_progress', responded_at: nowIso }).eq('id', p.request.id).eq('status', 'open').select('id').maybeSingle()
    if (moved) await logActivity({ requestId: p.request.id, actorId: p.actorId, action: 'status_changed', metadata: { from: 'open', to: 'in_progress', automated: true, reason: 'category sends to the CVM for approval' } })

    // 2. sent for approval to the CVM
    const { data: row } = await admin.from('requests').select('id, request_no, title, status, requester_id, org_id, waiting_since').eq('id', p.request.id).single()
    if (!row || !row.org_id || ['resolved', 'closed', 'cancelled', 'pending_approval'].includes(row.status)) return
    const res = await createAdHocApproval(admin, {
      request: { id: row.id, request_no: row.request_no, title: row.title, status: row.status, requester_id: row.requester_id, org_id: row.org_id, waiting_since: row.waiting_since },
      approvers: [{ id: cvm.id, full_name: cvm.full_name }],
      senderId: p.actorId,
      senderName: 'The system',
    })
    if (res.error) return await stop('The ticket could not be sent to the CVM for approval automatically. Please send it for approval yourself.')

    const { data: requester } = await admin.from('profiles').select('full_name').eq('id', p.requesterId).maybeSingle()
    await note(`Hello ${requester?.full_name ?? 'there'},

Your request ${p.request.request_no ?? ''} has been taken into process automatically and sent for approval to ${cvm.full_name}, the CVM of your store. We will continue as soon as it is approved.`, false)
  } catch (e) {
    console.error('[runAutoCvmApproval] failed', e)
  }
}
