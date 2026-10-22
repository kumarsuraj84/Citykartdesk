'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { applyStatusChange } from '@/lib/requests/status-change'
import { notify } from '@/lib/notifications'
import { saveTicketFile } from '@/lib/attachments/save'
import { settleRequest } from '@/lib/vendor/requests'
import { internalNote, loadPoContext, sendPoMailToOem, type PoContext } from '@/lib/vendor/po'
import { buildPoApprovedMail, buildPoRejectedMail } from '@/lib/vendor/po-mail'
import { checkPoApproval, checkPoRejection } from '@/lib/vendor/po-rules'
import { formatMoney, linesAsText, totalOf } from '@/lib/vendor/lines'
import type { ProfileWithTeams } from '@/types'

// The PO approver's two decisions on a vendor's PO request. Only the person named as the approver of THAT request (or an administrator, so a request never stalls
// when the approver is away) can decide, and only while the request is still open. Approving needs the PO number, the PO date and the PO document;
// rejecting needs a reason and cancels the ticket exactly like a rejected approval does (the store may reopen it within 48 hours).

type Result = { error?: string }

async function authorise(vendorRequestId: string): Promise<{ profile: ProfileWithTeams; po: PoContext } | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (profile.vendor_company_id) return { error: 'You are not allowed to decide a PO.' }
  const po = await loadPoContext(vendorRequestId)
  if (!po || po.vendorRequest.kind !== 'po') return { error: 'PO request not found.' }
  if (po.request.org_id !== profile.org_id) return { error: 'PO request not found.' }
  const mayDecide = po.vendorRequest.approver_id === profile.id || ['admin', 'platform_owner'].includes(profile.role)
  if (!mayDecide) return { error: 'This PO can be approved or rejected only by the approver it was sent to.' }
  if (po.vendorRequest.status !== 'pending') return { error: 'This PO request has already been decided.' }
  if (po.request.status !== 'hold_purchase_ho') return { error: 'The ticket is no longer waiting for this PO.' }
  return { profile, po }
}

function refresh(requestId: string, vendorRequestId: string) {
  revalidatePath(`/vendor-po/${vendorRequestId}`)
  revalidatePath(`/vendor/tickets/${requestId}`)
  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/purchase-orders')
  revalidatePath('/vendor')
}

/** Approve: PO number, PO date and the PO document are compulsory. The ticket goes back to In Progress; the vendor and the OEM are told. */
export async function approveVendorPo(formData: FormData): Promise<Result> {
  const vendorRequestId = String(formData.get('vendor_request_id') ?? '')
  const a = await authorise(vendorRequestId)
  if ('error' in a) return a
  const { profile, po } = a

  const file = formData.get('po_document')
  const check = checkPoApproval({ poNumber: String(formData.get('po_number') ?? ''), poDate: String(formData.get('po_date') ?? ''), hasFile: file instanceof File && file.size > 0 })
  if (!check.ok) return { error: check.error }

  const saved = await saveTicketFile({ requestId: po.request.id, file: file as File, uploadedBy: profile.id })
  if (saved.error || !saved.attachmentId) return { error: saved.error ?? 'The PO document could not be saved.' }

  const total = totalOf(po.lines)
  const comment = `PO approved by ${profile.full_name}. PO number: ${check.poNumber}. PO date: ${check.poDate}.\n${linesAsText(po.lines)}\nTotal (without GST): ${formatMoney(total)}`
  const supabase = await createClient()
  const res = await applyStatusChange({ supabase, profile }, po.request.id, 'in_progress', comment, { poDecision: 'approve' })
  if (res.error) {
    await createAdminClient().from('request_attachments').update({ deleted_at: new Date().toISOString() }).eq('id', saved.attachmentId)
    return res
  }
  await settleRequest(po.vendorRequest.id, 'approved', profile.id, null, { po_number: check.poNumber, po_date: check.poDate, po_attachment_id: saved.attachmentId })

  // one mail to the OEM's PO-details address, with the PO document attached
  const mail = buildPoApprovedMail({ ...po.mailBase, poNumber: check.poNumber, poDate: check.poDate, hasDocument: true })
  const sent = await sendPoMailToOem(po, mail, saved.attachmentId)
  if (sent.error) await internalNote(po.request.id, profile.id, `${sent.error} Please send the PO ${check.poNumber} to the OEM yourself.`)

  if (po.vendorPerson) {
    notify({
      recipientId: po.vendorPerson.id, actorId: profile.id, type: 'status_changed', title: `PO approved: ${po.request.request_no}`,
      body: `PO ${check.poNumber} (${check.poDate}) is approved. The ticket is back in progress.`, requestId: po.request.id, link: `/vendor/tickets/${po.request.id}`,
    }).catch(() => {})
  }
  refresh(po.request.id, po.vendorRequest.id)
  return {}
}

/** Reject: a reason is compulsory. The ticket is cancelled (as a rejected approval does); the OEM gets one short note; the vendor is told. */
export async function rejectVendorPo(input: { vendorRequestId: string; reason: string }): Promise<Result> {
  const a = await authorise(input.vendorRequestId)
  if ('error' in a) return a
  const { profile, po } = a
  const check = checkPoRejection(input.reason)
  if (!check.ok) return { error: check.error }

  const supabase = await createClient()
  const res = await applyStatusChange({ supabase, profile }, po.request.id, 'cancelled', `PO request rejected by ${profile.full_name}. Reason: ${check.reason}`, { poDecision: 'reject' })
  if (res.error) return res
  await settleRequest(po.vendorRequest.id, 'rejected', profile.id, check.reason)

  const sent = await sendPoMailToOem(po, buildPoRejectedMail({ ...po.mailBase, reason: check.reason }))
  if (sent.error) await internalNote(po.request.id, profile.id, `${sent.error} Please tell the OEM that the PO request was rejected.`)

  if (po.vendorPerson) {
    notify({
      recipientId: po.vendorPerson.id, actorId: profile.id, type: 'status_changed', title: `PO rejected: ${po.request.request_no}`,
      body: `The PO request was rejected and the ticket is cancelled. Reason: ${check.reason}`, requestId: po.request.id, link: `/vendor/tickets/${po.request.id}`,
    }).catch(() => {})
  }
  refresh(po.request.id, po.vendorRequest.id)
  return {}
}
