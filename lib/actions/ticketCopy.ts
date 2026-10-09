'use server'

// "CC" on a technician's public comment: suggestions for the CC box, and sending the copies once the comment is posted.
// Only CK Desk addresses (users and OEM contacts) are ever accepted - see lib/requests/cc-recipients.ts.

import { getCurrentProfile } from '@/lib/queries/profiles'
import { getRequestById, getRequestActivity, getRequestComments } from '@/lib/queries/requests'
import { getRequestAttachments } from '@/lib/queries/attachments'
import { getApprovalsForRequest } from '@/lib/queries/approvals'
import { loadCcBook, searchCcBook, validateCc, MAX_CC, type CcContact, type CcRejection } from '@/lib/requests/cc-recipients'
import { buildTicketPdfModel } from '@/lib/requests/ticket-pdf-model'
import { deliverTicketCopies } from '@/lib/requests/ticket-copy'

/** A comment can be copied for a short while after it is posted (the form does it right away). */
const COPY_WINDOW_MS = 15 * 60_000

const isAgentOf = (profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>, teamId: string) =>
  profile.role === 'manager' ||
  profile.role === 'admin' ||
  profile.role === 'platform_owner' ||
  (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === teamId))

export async function searchCcContacts(q: string): Promise<CcContact[]> {
  const profile = await getCurrentProfile()
  // technicians and above only; a plain requester never gets the address book
  if (!profile?.org_id || profile.role === 'user') return []
  const book = await loadCcBook(profile.org_id)
  return searchCcBook(book, String(q ?? '').slice(0, 80))
    .filter((c) => c.profileId !== profile.id)
}

export interface CopyOutcome {
  error?: string
  sent: { email: string; name: string }[]
  failed: CcRejection[]
  pdfAttached?: boolean
}

export async function copyCommentByEmail(requestId: string, commentId: string, emails: string[], attachPdf: boolean): Promise<CopyOutcome> {
  const none: CopyOutcome = { sent: [], failed: [] }
  const profile = await getCurrentProfile()
  if (!profile?.org_id) return { ...none, error: 'Not authenticated.' }
  if (!Array.isArray(emails) || emails.length === 0) return { ...none, error: 'No e-mail address was chosen.' }
  if (emails.length > 25) return { ...none, error: `At most ${MAX_CC} addresses can be copied on one comment.` }

  const request = await getRequestById(requestId)
  if (!request) return { ...none, error: 'Request not found.' }
  if (!isAgentOf(profile, request.team_id)) return { ...none, error: 'Only technicians of this request can copy a comment.' }

  const comments = await getRequestComments(requestId)
  const comment = comments.find((c) => c.id === commentId)
  if (!comment || comment.author?.id !== profile.id) return { ...none, error: 'You can only copy a comment you posted yourself.' }
  if (comment.is_internal) return { ...none, error: 'Internal notes are never sent to anyone.' }
  if (Date.now() - new Date(comment.created_at).getTime() > COPY_WINDOW_MS) return { ...none, error: 'This comment is too old to copy. Post a new comment instead.' }

  const book = await loadCcBook(profile.org_id)
  const { accepted, rejected } = validateCc(emails.map(String), book, { requesterId: request.requester_id, actorId: profile.id })
  if (accepted.length === 0) return { ...none, failed: rejected, error: rejected[0]?.reason ?? 'No valid CK Desk address.' }

  const [activity, attachments, approvals] = await Promise.all([getRequestActivity(requestId), getRequestAttachments(requestId), getApprovalsForRequest(requestId)])
  // always the requester's view: no technician-only fields, never internal notes
  const model = buildTicketPdfModel({
    request, comments, activity, attachments, approvals: approvals as never, csat: null,
    viewer: { name: profile.full_name, isAgent: false },
  })

  const { results, pdfAttached } = await deliverTicketCopies({
    requestId, model, newCommentId: commentId, recipients: accepted, attachPdf: !!attachPdf, copiedBy: profile.full_name, actorId: profile.id,
  })
  return {
    sent: results.filter((r) => r.ok).map((r) => ({ email: r.email, name: r.name })),
    failed: [...rejected, ...results.filter((r) => !r.ok).map((r) => ({ email: r.email, reason: r.error ?? 'Could not be sent.' }))],
    pdfAttached,
  }
}
