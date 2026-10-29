'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { applyStatusChange } from '@/lib/requests/status-change'
import { notify } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { saveTicketFile } from '@/lib/attachments/save'
import { createVendorRequest, linkFilesToComment, markRevisionRequested, OPEN_STATUSES, settleRequest, unsettleRequest, type VendorRequestStatus } from '@/lib/vendor/requests'
import { attachmentForMail, internalNote, isApproverOf, loadPoContext, sendPoMailToOem, userEmail, type PoContext } from '@/lib/vendor/po'
import { buildPoApprovedMail, buildPoRejectedMail, buildPoRevisionAskedMail, buildQuoteNotApprovedMail, buildVendorPoApprovedMail, buildVendorTicketCancelledMail } from '@/lib/vendor/po-mail'
import { checkPoApproval, checkPoRejection, checkPoRevision } from '@/lib/vendor/po-rules'
import { postPublicComment } from '@/lib/vendor/ticket-fields'
import { formatMoney, linesAsText, totalOf } from '@/lib/vendor/lines'
import type { ProfileWithTeams } from '@/types'

// The PO approver's decisions on a vendor's QUOTE. Only the person named as the approver of THAT request (or an administrator, so a request never stalls
// when the approver is away) can decide, and only while it is the latest version. The approver does not enter prices: he approves the quote as it is, asks the
// vendor for a revised price (the vendor sends a new quote version), or rejects.
//   Approve  - needs the PO number, the PO date and the PO document; the PO exists from this moment. The ticket goes back to In Progress.
//   Revise   - needs a note. The ticket stays on hold; the request waits for the vendor ("Revise price required" on his dashboard).
//   Reject   - needs a reason. Two kinds: the usual one rejects only the QUOTE (the ticket stays on hold and the vendor arranges the parts himself, no PO: it moves to his
//              "Part required" box with the quote's items as his parts list); the other also CANCELS the ticket, exactly like a rejected approval does (48 hours to reopen).

type Result = { error?: string }

async function authorise(vendorRequestId: string, allowed: VendorRequestStatus[]): Promise<{ profile: ProfileWithTeams; po: PoContext } | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (profile.vendor_company_id) return { error: 'You are not allowed to decide a PO.' }
  const po = await loadPoContext(vendorRequestId)
  if (!po || po.vendorRequest.kind !== 'po') return { error: 'PO request not found.' }
  if (po.request.org_id !== profile.org_id) return { error: 'PO request not found.' }
  const mayDecide = isApproverOf(po.vendorRequest, profile.id) || ['admin', 'platform_owner'].includes(profile.role)
  if (!mayDecide) return { error: 'This PO can be approved or rejected only by an approver it was sent to.' }
  if (po.vendorRequest.status === 'superseded') return { error: 'This quote was replaced by a newer version. Please open the newer one.' }
  if (!allowed.includes(po.vendorRequest.status)) {
    if (po.vendorRequest.status === 'revision_requested') return { error: 'A revised price has been asked for. Waiting for the vendor.' }
    // several approvers can hold the same request: the first decision is final and the others are told who made it
    const by = po.vendorRequest.decided_by && po.vendorRequest.decided_by !== profile.id
      ? (await createAdminClient().from('profiles').select('full_name').eq('id', po.vendorRequest.decided_by).maybeSingle()).data?.full_name
      : null
    return { error: by ? `This PO request has already been decided by ${by}.` : 'This PO request has already been decided.' }
  }
  if (po.request.status !== 'hold_purchase_ho') return { error: 'The ticket is no longer waiting for this PO.' }
  return { profile, po }
}

function refresh(requestId: string, vendorRequestId: string) {
  revalidatePath(`/vendor-po/${vendorRequestId}`)
  revalidatePath(`/vendor/tickets/${requestId}`)
  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/purchase-orders')
  revalidatePath('/vendor')
  revalidatePath('/vendor/pos')
}

/** Approve: PO number, PO date and the PO document are compulsory. The PO document shows in the conversation under the approval message. */
export async function approveVendorPo(formData: FormData): Promise<Result> {
  const vendorRequestId = String(formData.get('vendor_request_id') ?? '')
  const a = await authorise(vendorRequestId, ['pending'])
  if ('error' in a) return a
  const { profile, po } = a

  const file = formData.get('po_document')
  const check = checkPoApproval({ poNumber: String(formData.get('po_number') ?? ''), poDate: String(formData.get('po_date') ?? ''), hasFile: file instanceof File && file.size > 0 })
  if (!check.ok) return { error: check.error }

  const saved = await saveTicketFile({ requestId: po.request.id, file: file as File, uploadedBy: profile.id })
  if (saved.error || !saved.attachmentId) return { error: saved.error ?? 'The PO document could not be saved.' }

  const total = totalOf(po.lines)
  const comment = `PO approved by ${profile.full_name} on quote version ${po.vendorRequest.version}. PO number: ${check.poNumber}. PO date: ${check.poDate}.\n${linesAsText(po.lines)}\nTotal (without GST): ${formatMoney(total)}\nThe PO document is attached to this message.`
  const supabase = await createClient()
  const res = await applyStatusChange({ supabase, profile }, po.request.id, 'in_progress', comment, { poDecision: 'approve' })
  if (res.error) {
    await createAdminClient().from('request_attachments').update({ deleted_at: new Date().toISOString() }).eq('id', saved.attachmentId)
    return res
  }
  await linkFilesToComment(po.request.id, res.commentId, [saved.attachmentId])
  await settleRequest(po.vendorRequest.id, 'approved', profile.id, null, { po_number: check.poNumber, po_date: check.poDate, po_attachment_id: saved.attachmentId })

  // one mail to the OEM's PO-details address, with the PO document attached
  const mail = buildPoApprovedMail({ ...po.mailBase, poNumber: check.poNumber, poDate: check.poDate, hasDocument: true })
  const sent = await sendPoMailToOem(po, mail, saved.attachmentId)
  if (sent.error) await internalNote(po.request.id, profile.id, `${sent.error} Please send the PO ${check.poNumber} to the OEM yourself.`)

  if (po.vendorPerson) {
    // the vendor gets his own mail (with the PO document), not the generic "status changed" one
    const vTo = await userEmail(po.vendorPerson.id)
    if (vTo) {
      const doc = await attachmentForMail(saved.attachmentId)
      const vm = buildVendorPoApprovedMail({ ...po.mailBase, link: absoluteAppUrl(`/vendor/tickets/${po.request.id}`), poNumber: check.poNumber, poDate: check.poDate, approverName: profile.full_name, vendorPersonName: po.vendorPerson.full_name, hasDocument: !!doc })
      await sendEmail({ to: vTo, subject: vm.subject, html: vm.html, text: vm.text, attachments: doc ? [doc] : undefined, threadRequestNo: po.request.request_no }).catch(() => ({}))
    }
    notify({
      recipientId: po.vendorPerson.id, actorId: profile.id, type: 'status_changed', title: `PO approved: ${po.request.request_no}`,
      body: `PO ${check.poNumber} (${check.poDate}) is approved. The ticket is back in progress.`, requestId: po.request.id, link: `/vendor/tickets/${po.request.id}`, skipEmail: true,
    }).catch(() => {})
  }
  refresh(po.request.id, po.vendorRequest.id)
  return {}
}

/** Ask for a revised price: a note is compulsory. The ticket stays on hold; the quote waits for the vendor, who is told by mail and bell message. */
export async function requestPoRevision(input: { vendorRequestId: string; note: string }): Promise<Result> {
  const a = await authorise(input.vendorRequestId, ['pending'])
  if ('error' in a) return a
  const { profile, po } = a
  const check = checkPoRevision(input.note)
  if (!check.ok) return { error: check.error }

  const moved = await markRevisionRequested(po.vendorRequest.id, profile.id, check.note)
  if (!moved) return { error: 'This quote was just changed by someone else. Please refresh.' }
  await postPublicComment(po.request.id, profile.id, `Revised price requested by ${profile.full_name} (quote version ${po.vendorRequest.version}): ${check.note}`)

  if (po.vendorPerson) {
    const link = absoluteAppUrl(`/vendor/tickets/${po.request.id}`)
    const to = await userEmail(po.vendorPerson.id)
    if (to) {
      const mail = buildPoRevisionAskedMail({ ...po.mailBase, link, note: check.note, approverName: profile.full_name, vendorPersonName: po.vendorPerson.full_name })
      await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: po.request.request_no }).catch(() => ({}))
    }
    notify({
      recipientId: po.vendorPerson.id, actorId: profile.id, type: 'status_changed', title: `Revised price needed: ${po.request.request_no}`,
      body: check.note.length > 120 ? check.note.slice(0, 120) + '…' : check.note, requestId: po.request.id, link: `/vendor/tickets/${po.request.id}`, skipEmail: true,
    }).catch(() => {})
  }
  refresh(po.request.id, po.vendorRequest.id)
  return {}
}

/**
 * Reject: a reason is compulsory. Possible while the quote waits for either side.
 *  - default: only the QUOTE is rejected. The ticket is NOT cancelled and stays on hold (the clock stays paused); the quote's items become the vendor's parts list (no prices)
 *    and the ticket moves to his "Part required" box. He is told by mail and bell message. The OEM is not mailed (it is discussed offline and the job goes on).
 *  - cancelTicket: the ticket is cancelled (as a rejected approval does, 48 hours to reopen); the OEM gets one short note; the vendor is told.
 */
export async function rejectVendorPo(input: { vendorRequestId: string; reason: string; cancelTicket?: boolean }): Promise<Result> {
  const a = await authorise(input.vendorRequestId, ['pending', 'revision_requested'])
  if ('error' in a) return a
  const { profile, po } = a
  const check = checkPoRejection(input.reason)
  if (!check.ok) return { error: check.error }

  if (!input.cancelTicket) {
    const before = po.vendorRequest.status
    if (!(await settleRequest(po.vendorRequest.id, 'rejected', profile.id, check.reason, undefined, OPEN_STATUSES))) return { error: 'This quote was just changed by someone else. Please refresh.' }
    const parts = await createVendorRequest({
      orgId: po.request.org_id, requestId: po.request.id, kind: 'parts', createdBy: profile.id, lines: po.lines.map((l) => ({ item_name: l.item_name, qty: l.qty, price_excl_gst: null })),
      extra: { revision_note: `Quote not approved: ${check.reason}`, revision_requested_by: profile.id, revision_requested_at: new Date().toISOString() },
    })
    if (parts.error || !parts.id) {
      await unsettleRequest(po.vendorRequest.id, before, true)
      return { error: parts.error ?? 'Could not move the ticket to Part required.' }
    }
    await postPublicComment(po.request.id, profile.id, `Quote (version ${po.vendorRequest.version}) not approved by ${profile.full_name}. Reason: ${check.reason}\nThe ticket is not cancelled. The vendor will arrange the parts himself (no PO). Parts needed:\n${linesAsText(po.lines.map((l) => ({ ...l, price_excl_gst: null })))}`)
    if (po.vendorPerson) {
      const link = absoluteAppUrl(`/vendor/tickets/${po.request.id}`)
      const to = await userEmail(po.vendorPerson.id)
      if (to) {
        const mail = buildQuoteNotApprovedMail({ ...po.mailBase, link, reason: check.reason, approverName: profile.full_name, vendorPersonName: po.vendorPerson.full_name })
        await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: po.request.request_no }).catch(() => ({}))
      }
      notify({
        recipientId: po.vendorPerson.id, actorId: profile.id, type: 'status_changed', title: `Quote not approved - arrange the parts: ${po.request.request_no}`,
        body: check.reason.length > 120 ? check.reason.slice(0, 120) + '…' : check.reason, requestId: po.request.id, link: `/vendor/tickets/${po.request.id}`, skipEmail: true,
      }).catch(() => {})
    }
    refresh(po.request.id, po.vendorRequest.id)
    return {}
  }

  const supabase = await createClient()
  const res = await applyStatusChange({ supabase, profile }, po.request.id, 'cancelled', `Cancelled because the cost of the repair was not approved (${profile.full_name}). Reason: ${check.reason}\nIf the ${po.assetKind} is still not working, you can reopen the request within 48 hours.`, { poDecision: 'reject' })
  if (res.error) return res
  await settleRequest(po.vendorRequest.id, 'rejected', profile.id, check.reason, undefined, OPEN_STATUSES)

  const sent = await sendPoMailToOem(po, buildPoRejectedMail({ ...po.mailBase, reason: check.reason }))
  if (sent.error) await internalNote(po.request.id, profile.id, `${sent.error} Please tell the OEM that the PO request was rejected.`)

  if (po.vendorPerson) {
    const vTo = await userEmail(po.vendorPerson.id)
    if (vTo) {
      const vm = buildVendorTicketCancelledMail({ ...po.mailBase, link: absoluteAppUrl(`/vendor/tickets/${po.request.id}`), reason: check.reason, approverName: profile.full_name, vendorPersonName: po.vendorPerson.full_name })
      await sendEmail({ to: vTo, subject: vm.subject, html: vm.html, text: vm.text, threadRequestNo: po.request.request_no }).catch(() => ({}))
    }
    notify({
      recipientId: po.vendorPerson.id, actorId: profile.id, type: 'status_changed', title: `PO rejected: ${po.request.request_no}`,
      body: `The PO request was rejected and the ticket is cancelled. Reason: ${check.reason}`, requestId: po.request.id, link: `/vendor/tickets/${po.request.id}`, skipEmail: true,
    }).catch(() => {})
  }
  refresh(po.request.id, po.vendorRequest.id)
  return {}
}
