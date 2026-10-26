'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { applyStatusChange } from '@/lib/requests/status-change'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { buildPmsResolutionText, buildResolutionText, checkVendorResolve, checkVendorResolvePms, checkVendorStart, resolutionChoices, todayIstDate } from '@/lib/vendor/fields'
import { isPmsRequest } from '@/lib/pms/is-pms'
import { loadLiveResolutionField } from '@/lib/vendor/live-form'
import { linkFilesToComment, ownFiles } from '@/lib/vendor/requests'
import { refreshVendorPaths, vendorTechAndTicket } from '@/lib/vendor/ctx'
import { loadTicketForm, mergeFormData } from '@/lib/vendor/ticket-fields'

// The actions an OEM engineer (vendor technician) can take on a ticket assigned to him. Each one checks who he is and that the ticket is his,
// checks the stage rules (OEM ticket number to start; resolution, remarks for "Other" and the FSR to resolve), and then makes the change through
// the one status-change function the whole application uses (lib/requests/status-change.ts), so the SLA, the history and the e-mails behave as everywhere.

type Result = { error?: string }

const refresh = refreshVendorPaths

/** Start working: the OEM ticket number is compulsory; it is saved in "AC OEM Ticket Number" and today's date in "AC OEM Ticket Creation Date". */
export async function vendorStartWorking(requestId: string, oemNumberRaw: string): Promise<Result> {
  const ctx = await vendorTechAndTicket(requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'open' && ticket.status !== 'assigned') return { error: 'This ticket has already been started.' }

  // an AC PMS visit has no OEM ticket number: starting it needs nothing but the button
  const pms = await isPmsRequest(createAdminClient() as never, requestId)
  let message: string
  if (pms) {
    message = `${profile.full_name} (vendor) started the AC PMS visit.`
  } else {
    const check = checkVendorStart(oemNumberRaw)
    if (!check.ok) return { error: check.error }

    const form = await loadTicketForm(requestId)
    if (!form) return { error: 'Request not found.' }
    const patch: Record<string, unknown> = {}
    if (form.fields.oemNumber) patch[form.fields.oemNumber.id] = check.oemNumber
    if (form.fields.oemDate) patch[form.fields.oemDate.id] = todayIstDate()
    const saved = await mergeFormData(requestId, patch)
    if (saved.error) return saved

    message = `${profile.full_name} (vendor) started work on this ticket. OEM ticket number: ${check.oemNumber}.`
  }
  const res = await applyStatusChange({ supabase, profile }, requestId, 'in_progress', message, { vendorFlow: 'start' })
  if (res.error) return res
  refresh(requestId)
  return {}
}

/** Resolve: the AC RESOLUTION choice (or "Other" with remarks) and at least one FSR attachment. The choice is saved in "AC resolution" and is the final resolution text. */
export async function vendorResolve(input: { requestId: string; choice: string; remarks: string; attachmentIds: string[] }): Promise<Result> {
  const ctx = await vendorTechAndTicket(input.requestId)
  if ('error' in ctx) return ctx
  const { profile, ticket, supabase } = ctx
  if (ticket.status !== 'in_progress') return { error: 'Start working on the ticket before resolving it.' }

  const choiceValue = (input.choice ?? '').trim()
  const remarks = (input.remarks ?? '').trim().slice(0, 2000)

  // an AC PMS visit: no resolution list; the PMS report (an attachment) is what is needed, remarks are optional
  if (await isPmsRequest(createAdminClient() as never, input.requestId)) {
    const pmsFiles = await ownFiles(input.requestId, profile.id, (input.attachmentIds ?? []).slice(0, 20))
    const pmsCheck = checkVendorResolvePms({ fsrCount: pmsFiles.length })
    if (!pmsCheck.ok) return { error: pmsCheck.error }
    const done = await applyStatusChange({ supabase, profile }, input.requestId, 'resolved', buildPmsResolutionText(remarks), { vendorFlow: 'resolve' })
    if (done.error) return done
    await linkFilesToComment(input.requestId, done.commentId, pmsFiles)   // the PMS report shows right under the resolution in the conversation
    refresh(input.requestId)
    return {}
  }

  const form = await loadTicketForm(input.requestId)
  if (!form) return { error: 'Request not found.' }
  // the choice must be one of the administrator's CURRENT list (or "Other"); what is saved is the list's own value, what is written to the conversation is its words
  const picked = resolutionChoices(await loadLiveResolutionField(form.serviceId, form.sections)).find((c) => c.value === choiceValue)
  if (choiceValue && !picked) return { error: 'Please choose the resolution from the list.' }
  const fsrIds = await ownFiles(input.requestId, profile.id, (input.attachmentIds ?? []).slice(0, 20))
  const fsrCount = fsrIds.length
  const check = checkVendorResolve({ choice: picked?.label ?? '', remarks, fsrCount })
  if (!check.ok) return { error: check.error }

  if (form.fields.resolution) {
    const saved = await mergeFormData(input.requestId, { [form.fields.resolution.id]: picked!.value })
    if (saved.error) return saved
  }
  const res = await applyStatusChange({ supabase, profile }, input.requestId, 'resolved', buildResolutionText(picked!.label, remarks), { vendorFlow: 'resolve' })
  if (res.error) return res
  await linkFilesToComment(input.requestId, res.commentId, fsrIds)   // the FSR shows right under the resolution in the conversation
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
