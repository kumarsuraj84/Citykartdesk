'use server'

import { applyStatusChange } from '@/lib/requests/status-change'
import { notify } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { refreshVendorPaths, vendorTechAndTicket } from '@/lib/vendor/ctx'
import { checkLines, formatMoney, linesAsText, totalOf, type RequestLineInput } from '@/lib/vendor/lines'
import {
  createNextVersion, createVendorRequest, getOpenRequest, getRequestItems, linkFilesToComment, ownFiles, settleRequest, OPEN_STATUSES,
} from '@/lib/vendor/requests'
import { loadPoContext, resolvePoApprover, userEmail } from '@/lib/vendor/po'
import { buildPoApprovalRequestMail, buildQuoteWithdrawnMail } from '@/lib/vendor/po-mail'
import { postPublicComment } from '@/lib/vendor/ticket-fields'

// What a vendor technician asks for while working a ticket: parts (a list, no PO) or a PO (a QUOTE: items, quantity, price without GST, and the quote file).
// Both can be changed or withdrawn while the ticket is on hold. A change is a new VERSION; the earlier one is "superseded" and cannot be approved.
// The ticket's status is only touched when it goes on hold and when it comes back; versions and revision requests do not move it (the clock stays paused).

type Result = { error?: string }
const refresh = refreshVendorPaths

const needQuote = (n: number) => (n < 1 ? 'Please attach the quote before you send it.' : null)

// ── Part required (no PO) ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Part required": the vendor lists the items (name, quantity); the ticket goes on hold (the clock stops) until he reports the parts received. */
export async function vendorRequestParts(input: { requestId: string; lines: RequestLineInput[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'in_progress') return { error: 'Start working on the ticket before asking for parts.' }
  const checked = checkLines(input.lines, { withPrice: false })
  if (!checked.ok) return { error: checked.error }
  if (await getOpenRequest(input.requestId)) return { error: 'This ticket already has an open request.' }

  const made = await createVendorRequest({ orgId: profile.org_id as string, requestId: input.requestId, kind: 'parts', createdBy: profile.id, lines: checked.lines })
  if (made.error || !made.id) return { error: made.error ?? 'Could not save the request.' }
  const res = await applyStatusChange({ supabase, profile }, input.requestId, 'hold_purchase_ho', `Part required (no PO). ${profile.full_name} needs these parts:\n${linesAsText(checked.lines)}`, { vendorFlow: 'hold' })
  if (res.error) {
    await settleRequest(made.id, 'cancelled', profile.id, 'The ticket could not be put on hold.')
    return res
  }
  refresh(input.requestId)
  return {}
}

/** The vendor corrects the parts list while the ticket is on hold (a wrong item, a missing line, a different quantity). The ticket stays on hold. */
export async function vendorUpdateParts(input: { requestId: string; lines: RequestLineInput[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket } = ctx
  if (ticket.status !== 'hold_purchase_ho') return { error: 'This ticket is not on hold.' }
  const open = await getOpenRequest(input.requestId)
  if (!open || open.kind !== 'parts') return { error: 'There is no parts list to change on this ticket.' }
  const checked = checkLines(input.lines, { withPrice: false })
  if (!checked.ok) return { error: checked.error }

  const made = await createNextVersion(open, { orgId: profile.org_id as string, requestId: input.requestId, kind: 'parts', createdBy: profile.id, lines: checked.lines })
  if (made.error || !made.id) return { error: made.error ?? 'Could not save the list.' }
  await postPublicComment(input.requestId, profile.id, `Parts list updated (version ${made.version}) by ${profile.full_name}:\n${linesAsText(checked.lines)}`)
  refresh(input.requestId)
  return {}
}

/** "Parts received": the engineer is back with the parts. A remark is compulsory; the ticket returns to In Progress (it cannot be resolved straight from hold). */
export async function vendorPartsReceived(requestId: string, remark: string): Promise<Result> {
  const ctx = await vendorTechAndTicket(requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'hold_purchase_ho') return { error: 'This ticket is not on hold.' }
  const open = await getOpenRequest(requestId)
  if (!open || open.kind !== 'parts') return { error: 'There is no parts request to close on this ticket.' }
  const text = (remark ?? '').trim()
  if (text.length < 3) return { error: 'Please write a remark (for example "parts received, engineer on site").' }
  if (text.length > 1000) return { error: 'The remark is too long.' }

  const res = await applyStatusChange({ supabase, profile }, requestId, 'in_progress', /^parts received/i.test(text) ? text : `Parts received. ${text}`, { vendorFlow: 'resume' })
  if (res.error) return res
  await settleRequest(open.id, 'received', profile.id, text, undefined, OPEN_STATUSES)
  refresh(requestId)
  return {}
}

// ── PO required from Citykart (a quote) ──────────────────────────────────────────────────────────────────────────────────────────────

/** ONE approval mail (and a bell message) to the PO approver; the page behind the link needs a sign-in. Never throws. */
async function askApprover(vendorRequestId: string, requestNo: string, actorId: string, actorName: string, approver: { id: string; full_name: string }) {
  try {
    const po = await loadPoContext(vendorRequestId)
    if (!po) return
    const to = await userEmail(approver.id)
    const link = absoluteAppUrl(`/vendor-po/${vendorRequestId}`)
    const total = totalOf(po.lines)
    if (to) {
      const mail = buildPoApprovalRequestMail({ ...po.mailBase, link, approverName: approver.full_name, version: po.vendorRequest.version, previousTotal: po.previousTotal })
      await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: requestNo })
    }
    await notify({
      recipientId: approver.id, actorId, type: 'status_changed',
      title: `${po.vendorRequest.version > 1 ? `Revised quote (version ${po.vendorRequest.version})` : 'PO approval needed'}: ${requestNo}`,
      body: `${actorName} sent a quote (total without GST ${formatMoney(total)}).`, requestId: po.request.id, link: `/vendor-po/${vendorRequestId}`, skipEmail: true,
    })
  } catch (e) {
    console.error('[askApprover] approval mail failed', e)
  }
}

/**
 * "PO required": the vendor lists the items (name, quantity, price WITHOUT GST) and attaches his QUOTE (compulsory). The ticket goes on hold (the clock stops) and ONE approval
 * request goes to the PO approver (Krishan unless an administrator chose somebody else). The quote shows in the conversation with its file.
 */
export async function vendorRequestPo(input: { requestId: string; lines: RequestLineInput[]; quoteAttachmentIds: string[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'in_progress') return { error: 'Start working on the ticket before asking for a PO.' }
  const checked = checkLines(input.lines, { withPrice: true })
  if (!checked.ok) return { error: checked.error }
  const quoteIds = await ownFiles(input.requestId, profile.id, (input.quoteAttachmentIds ?? []).slice(0, 10))
  const noQuote = needQuote(quoteIds.length)
  if (noQuote) return { error: noQuote }
  if (await getOpenRequest(input.requestId)) return { error: 'This ticket already has an open request.' }
  const approver = await resolvePoApprover(profile.org_id as string)
  if (!approver) return { error: 'No PO approver is set up yet. Please ask Citykart to set one (Admin > Vendors).' }

  const made = await createVendorRequest({
    orgId: profile.org_id as string, requestId: input.requestId, kind: 'po', createdBy: profile.id, lines: checked.lines, quoteAttachmentIds: quoteIds, extra: { approver_id: approver.id },
  })
  if (made.error || !made.id) return { error: made.error ?? 'Could not save the request.' }
  const text = `PO required from Citykart (quote version 1). ${profile.full_name} needs a purchase order for:\n${linesAsText(checked.lines)}\nTotal (without GST): ${formatMoney(checked.total ?? 0)}\nThe quote file is attached to this message.`
  const res = await applyStatusChange({ supabase, profile }, input.requestId, 'hold_purchase_ho', text, { vendorFlow: 'hold' })
  if (res.error) {
    await settleRequest(made.id, 'cancelled', profile.id, 'The ticket could not be put on hold.')
    return res
  }
  await linkFilesToComment(input.requestId, res.commentId, quoteIds)
  await askApprover(made.id, ticket.request_no, profile.id, profile.full_name, approver)
  refresh(input.requestId)
  return {}
}

/** The approver asked for a revised price: the vendor sends a new version (new prices, a new quote file). The old version can no longer be approved; the approver gets ONE new request. */
export async function vendorRevisePo(input: { requestId: string; lines: RequestLineInput[]; quoteAttachmentIds: string[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket } = ctx
  if (ticket.status !== 'hold_purchase_ho') return { error: 'This ticket is not on hold.' }
  const open = await getOpenRequest(input.requestId)
  if (!open || open.kind !== 'po' || open.status !== 'revision_requested') return { error: 'No revised price has been asked for on this ticket.' }
  const checked = checkLines(input.lines, { withPrice: true })
  if (!checked.ok) return { error: checked.error }
  const quoteIds = await ownFiles(input.requestId, profile.id, (input.quoteAttachmentIds ?? []).slice(0, 10))
  const noQuote = needQuote(quoteIds.length)
  if (noQuote) return { error: noQuote }
  // a file already used as a quote of an earlier version cannot stand in for the NEW quote
  if (quoteIds.every((id) => (open.quote_attachment_ids ?? []).includes(id))) return { error: 'Please attach the revised quote (a new file).' }
  const approver = (open.approver_id && { id: open.approver_id, full_name: '' }) || (await resolvePoApprover(profile.org_id as string))
  if (!approver) return { error: 'No PO approver is set up yet. Please ask Citykart to set one (Admin > Vendors).' }

  const before = totalOf((await getRequestItems(open.id)).map((i) => ({ qty: i.qty, price_excl_gst: i.price_excl_gst })))
  const made = await createNextVersion(open, {
    orgId: profile.org_id as string, requestId: input.requestId, kind: 'po', createdBy: profile.id, lines: checked.lines, quoteAttachmentIds: quoteIds, extra: { approver_id: approver.id },
  })
  if (made.error || !made.id) return { error: made.error ?? 'Could not save the quote.' }
  const text = `Revised quote (version ${made.version}) sent by ${profile.full_name}. Total was ${formatMoney(before)}, now ${formatMoney(checked.total ?? 0)}.\n${linesAsText(checked.lines)}\nThe revised quote file is attached to this message.`
  const commentId = await postPublicComment(input.requestId, profile.id, text)
  await linkFilesToComment(input.requestId, commentId, quoteIds)
  const named = approver.full_name ? approver : (await resolvePoApprover(profile.org_id as string)) ?? { id: approver.id, full_name: 'Approver' }
  await askApprover(made.id, ticket.request_no, profile.id, profile.full_name, named)
  refresh(input.requestId)
  return {}
}

/** The vendor withdraws his open request (parts or quote), for example because he raised it by mistake. The ticket returns to In Progress; the reason is in the conversation. */
export async function vendorWithdrawRequest(input: { requestId: string; reason: string }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'hold_purchase_ho') return { error: 'This ticket is not on hold.' }
  const open = await getOpenRequest(input.requestId)
  if (!open) return { error: 'There is no open request on this ticket.' }
  const reason = (input.reason ?? '').replace(/\s+/g, ' ').trim()
  if (reason.length < 3) return { error: 'Please say why you are withdrawing it.' }
  if (reason.length > 1000) return { error: 'The reason is too long.' }

  const res = await applyStatusChange({ supabase, profile }, input.requestId, 'in_progress', `${open.kind === 'po' ? 'PO request' : 'Parts request'} withdrawn by ${profile.full_name}. Reason: ${reason}`, { vendorFlow: 'resume' })
  if (res.error) return res
  await settleRequest(open.id, 'withdrawn', profile.id, reason, undefined, OPEN_STATUSES)

  // the approver was waiting on this quote: he is told it is gone (mail and bell)
  if (open.kind === 'po' && open.approver_id) {
    try {
      const po = await loadPoContext(open.id)
      const to = await userEmail(open.approver_id)
      const approver = await resolvePoApprover(profile.org_id as string)
      const approverName = approver && approver.id === open.approver_id ? approver.full_name : 'Approver'
      if (po && to) {
        const mail = buildQuoteWithdrawnMail({ ...po.mailBase, link: absoluteAppUrl(`/vendor-po/${open.id}`), reason, approverName, vendorPersonName: profile.full_name, version: open.version })
        await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: ticket.request_no })
      }
      await notify({ recipientId: open.approver_id, actorId: profile.id, type: 'status_changed', title: `Quote withdrawn: ${ticket.request_no}`, body: reason, requestId: input.requestId, link: `/vendor-po/${open.id}`, skipEmail: true })
    } catch (e) {
      console.error('[vendorWithdrawRequest] approver mail failed', e)
    }
  }
  refresh(input.requestId)
  return {}
}
