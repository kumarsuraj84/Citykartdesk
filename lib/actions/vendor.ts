'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { applyStatusChange } from '@/lib/requests/status-change'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { vendorRoleOf } from '@/lib/vendor/access'
import { buildResolutionText, checkVendorResolve, checkVendorStart, resolutionChoices, todayIstDate } from '@/lib/vendor/fields'
import { loadLiveResolutionField } from '@/lib/vendor/live-form'
import { checkLines, formatMoney, linesAsText, type RequestLineInput } from '@/lib/vendor/lines'
import { createVendorRequest, getPendingRequest, settleRequest } from '@/lib/vendor/requests'
import { loadPoContext, resolvePoApprover, userEmail } from '@/lib/vendor/po'
import { buildPoApprovalRequestMail } from '@/lib/vendor/po-mail'
import { sendEmail } from '@/lib/email/send'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { loadTicketForm, mergeFormData } from '@/lib/vendor/ticket-fields'
import type { ProfileWithTeams, RequestStatus } from '@/types'

// The actions an OEM engineer (vendor technician) can take on a ticket assigned to him. Each one checks who he is and that the ticket is his,
// checks the stage rules (OEM ticket number to start; resolution, remarks for "Other" and the FSR to resolve), and then makes the change through
// the one status-change function the whole application uses (lib/requests/status-change.ts), so the SLA, the history and the e-mails behave as everywhere.

type Result = { error?: string }

type Ticket = { id: string; status: RequestStatus; assigned_to: string | null; requester_id: string; request_no: string; title: string }

/** The signed-in vendor TECHNICIAN and one of his tickets (read through his own login, so row security applies). */
async function vendorTechAndTicket(requestId: string): Promise<{ profile: ProfileWithTeams; ticket: Ticket; supabase: Awaited<ReturnType<typeof createClient>> } | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (vendorRoleOf(profile) !== 'technician') return { error: 'Only a vendor technician can do this.' }
  const supabase = await createClient()
  const { data } = await supabase.from('requests').select('id, status, assigned_to, requester_id, request_no, title').eq('id', requestId).maybeSingle()
  const ticket = data as Ticket | null
  if (!ticket || ticket.assigned_to !== profile.id) return { error: 'This ticket is not assigned to you.' }
  return { profile, ticket, supabase }
}

function refresh(requestId: string) {
  revalidatePath(`/vendor/tickets/${requestId}`)
  revalidatePath('/vendor')
  revalidatePath(`/requests/${requestId}`)
}

/** Start working: the OEM ticket number is compulsory; it is saved in "AC OEM Ticket Number" and today's date in "AC OEM Ticket Creation Date". */
export async function vendorStartWorking(requestId: string, oemNumberRaw: string): Promise<Result> {
  const ctx = await vendorTechAndTicket(requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'open' && ticket.status !== 'assigned') return { error: 'This ticket has already been started.' }

  const check = checkVendorStart(oemNumberRaw)
  if (!check.ok) return { error: check.error }

  const form = await loadTicketForm(requestId)
  if (!form) return { error: 'Request not found.' }
  const patch: Record<string, unknown> = {}
  if (form.fields.oemNumber) patch[form.fields.oemNumber.id] = check.oemNumber
  if (form.fields.oemDate) patch[form.fields.oemDate.id] = todayIstDate()
  const saved = await mergeFormData(requestId, patch)
  if (saved.error) return saved

  const message = `${profile.full_name} (vendor) started work on this ticket. OEM ticket number: ${check.oemNumber}.`
  const res = await applyStatusChange({ supabase, profile }, requestId, 'in_progress', message, { vendorFlow: 'start' })
  if (res.error) return res
  refresh(requestId)
  return {}
}

/** Files the vendor uploaded to this ticket (the FSR), checked before the ticket can be resolved. */
async function countOwnAttachments(requestId: string, profileId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { data } = await (createAdminClient() as unknown as { from: (t: string) => any }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from('request_attachments').select('id').eq('request_id', requestId).eq('uploaded_by', profileId).is('deleted_at', null).in('id', ids)
  return (data ?? []).length
}

/** Resolve: the AC RESOLUTION choice (or "Other" with remarks) and at least one FSR attachment. The choice is saved in "AC resolution" and is the final resolution text. */
export async function vendorResolve(input: { requestId: string; choice: string; remarks: string; attachmentIds: string[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'in_progress') return { error: 'Start working on the ticket before resolving it.' }

  const choiceValue = (input.choice ?? '').trim()
  const remarks = (input.remarks ?? '').trim().slice(0, 2000)
  const form = await loadTicketForm(input.requestId)
  if (!form) return { error: 'Request not found.' }
  // the choice must be one of the administrator's CURRENT list (or "Other"); what is saved is the list's own value, what is written to the conversation is its words
  const picked = resolutionChoices(await loadLiveResolutionField(form.serviceId, form.sections)).find((c) => c.value === choiceValue)
  if (choiceValue && !picked) return { error: 'Please choose the resolution from the list.' }
  const fsrCount = await countOwnAttachments(input.requestId, profile.id, (input.attachmentIds ?? []).slice(0, 20))
  const check = checkVendorResolve({ choice: picked?.label ?? '', remarks, fsrCount })
  if (!check.ok) return { error: check.error }

  if (form.fields.resolution) {
    const saved = await mergeFormData(input.requestId, { [form.fields.resolution.id]: picked!.value })
    if (saved.error) return saved
  }
  const res = await applyStatusChange({ supabase, profile }, input.requestId, 'resolved', buildResolutionText(picked!.label, remarks), { vendorFlow: 'resolve' })
  if (res.error) return res
  refresh(input.requestId)
  return {}
}

/** A public message from the vendor on his own ticket (the store and Citykart read it; internal notes are not available to a vendor). */
export async function vendorAddComment(requestId: string, body: string): Promise<Result> {
  const ctx = await vendorTechAndTicket(requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket } = ctx
  const text = (body ?? '').trim()
  if (!text) return { error: 'Comment cannot be empty.' }
  if (text.length > 5000) return { error: 'The comment is too long.' }
  if (ticket.status === 'closed' || ticket.status === 'cancelled') return { error: 'This ticket is finished.' }

  const admin = createAdminClient()
  const { error } = await admin.from('request_comments').insert({ request_id: requestId, author_id: profile.id, body: text, is_internal: false })
  if (error) return { error: 'Failed to post the comment.' }
  await logActivity({ requestId, actorId: profile.id, action: 'comment_added' })
  notify({
    recipientId: ticket.requester_id, actorId: profile.id, type: 'comment_added',
    title: `${profile.full_name} commented on a request`, body: text.length > 120 ? text.slice(0, 120) + '…' : text,
    requestId, link: `/requests/${requestId}?tab=conversations`,
  }).catch(() => {})
  refresh(requestId)
  return {}
}

// ── Part required (no PO) ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Part required": the vendor lists the items (name, quantity); the ticket goes on hold (the clock stops) until he reports the parts received. */
export async function vendorRequestParts(input: { requestId: string; lines: RequestLineInput[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'in_progress') return { error: 'Start working on the ticket before asking for parts.' }
  const checked = checkLines(input.lines, { withPrice: false })
  if (!checked.ok) return { error: checked.error }
  if (await getPendingRequest(input.requestId)) return { error: 'This ticket already has an open request.' }

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

/** "Parts received": the engineer is back with the parts. A remark is compulsory; the ticket returns to In Progress (it cannot be resolved straight from hold). */
export async function vendorPartsReceived(requestId: string, remark: string): Promise<Result> {
  const ctx = await vendorTechAndTicket(requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'hold_purchase_ho') return { error: 'This ticket is not on hold.' }
  const pending = await getPendingRequest(requestId)
  if (!pending || pending.kind !== 'parts') return { error: 'There is no parts request to close on this ticket.' }
  const text = (remark ?? '').trim()
  if (text.length < 3) return { error: 'Please write a remark (for example "parts received, engineer on site").' }
  if (text.length > 1000) return { error: 'The remark is too long.' }

  const res = await applyStatusChange({ supabase, profile }, requestId, 'in_progress', `Parts received. ${text}`, { vendorFlow: 'resume' })
  if (res.error) return res
  await settleRequest(pending.id, 'received', profile.id, text)
  refresh(requestId)
  return {}
}

// ── PO required from Citykart ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * "PO required": the vendor lists the items (name, quantity, price WITHOUT GST). The ticket goes on hold (the clock stops) and ONE approval request goes to the PO approver
 * (Krishan unless an administrator chose somebody else). The approver enters the PO number, date and document on the approval page; see lib/actions/vendor-po.ts.
 */
export async function vendorRequestPo(input: { requestId: string; lines: RequestLineInput[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'in_progress') return { error: 'Start working on the ticket before asking for a PO.' }
  const checked = checkLines(input.lines, { withPrice: true })
  if (!checked.ok) return { error: checked.error }
  if (await getPendingRequest(input.requestId)) return { error: 'This ticket already has an open request.' }
  const approver = await resolvePoApprover(profile.org_id as string)
  if (!approver) return { error: 'No PO approver is set up yet. Please ask Citykart to set one (Admin > Vendors).' }

  const made = await createVendorRequest({ orgId: profile.org_id as string, requestId: input.requestId, kind: 'po', createdBy: profile.id, lines: checked.lines, extra: { approver_id: approver.id } })
  if (made.error || !made.id) return { error: made.error ?? 'Could not save the request.' }
  const text = `PO required from Citykart. ${profile.full_name} needs a purchase order for:\n${linesAsText(checked.lines)}\nTotal (without GST): ${formatMoney(checked.total ?? 0)}`
  const res = await applyStatusChange({ supabase, profile }, input.requestId, 'hold_purchase_ho', text, { vendorFlow: 'hold' })
  if (res.error) {
    await settleRequest(made.id, 'cancelled', profile.id, 'The ticket could not be put on hold.')
    return res
  }

  // ONE approval mail (and a bell message) to the approver; the page behind the link needs a sign-in.
  try {
    const po = await loadPoContext(made.id)
    const to = await userEmail(approver.id)
    const link = absoluteAppUrl(`/vendor-po/${made.id}`)
    if (po && to) {
      const mail = buildPoApprovalRequestMail({ ...po.mailBase, link, approverName: approver.full_name })
      await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: ticket.request_no })
    }
    await notify({
      recipientId: approver.id, actorId: profile.id, type: 'status_changed', title: `PO approval needed: ${ticket.request_no}`,
      body: `${profile.full_name} needs a purchase order (total without GST ${formatMoney(checked.total ?? 0)}).`, requestId: input.requestId, link: `/vendor-po/${made.id}`, skipEmail: true,
    })
  } catch (e) {
    console.error('[vendorRequestPo] approval mail failed', e)
  }
  refresh(input.requestId)
  return {}
}
