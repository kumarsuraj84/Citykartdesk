import { createAdminClient } from '@/lib/supabase/admin'
import { notify, getRequestAudience } from '@/lib/notifications'
import { logActivity } from '@/lib/activity'
import { logger } from '@/lib/observability/logger'
import { applyStatusChange } from '@/lib/requests/status-change'
import type { ProfileWithTeams } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type EmailReplyAuthor =
  | { kind: 'profile'; profileId: string; name: string }
  | { kind: 'oem'; name: string; email: string }

/**
 * Adds an emailed reply to a ticket's conversation — the counterpart to addComment()
 * (lib/actions/requests.ts) for a reply that came in by email instead of the portal.
 * Deliberately mirrors addComment()'s own behavior (same notified audience, same
 * waiting-on-user auto-resume) so a technician sees no difference except where the
 * message came from. Always public (an outsider can never author an internal note) and
 * never throws — a failure here must not crash the inbound mail sync for other messages.
 */
export async function appendEmailReplyComment(params: {
  requestId: string
  body: string
  author: EmailReplyAuthor
}): Promise<{ commentId?: string; error?: string }> {
  const { requestId, body, author } = params
  const trimmed = body.trim()
  if (!trimmed) return { error: 'Empty reply body.' }

  const admin = createAdminClient() as unknown as AnyClient

  const { data: request } = await admin
    .from('requests')
    .select('id, status, requester_id, waiting_since, response_due_at, resolution_due_at, paused_ms_total')
    .eq('id', requestId)
    .maybeSingle()
  if (!request) return { error: 'Request not found.' }

  const isProfileAuthor = author.kind === 'profile'
  const insertRow = {
    request_id: requestId,
    author_id: isProfileAuthor ? author.profileId : null,
    body: trimmed,
    is_internal: false,
    source: 'email',
    external_name: isProfileAuthor ? null : author.name,
    external_email: isProfileAuthor ? null : author.email,
  }

  const { data: inserted, error: insertError } = await admin
    .from('request_comments')
    .insert(insertRow)
    .select('id')
    .single()
  if (insertError || !inserted) return { error: insertError?.message ?? 'Failed to store the reply.' }

  const actorProfileId = isProfileAuthor ? author.profileId : null
  // A reply to a ticket that is already finished is still stored (nobody's words are lost) but the history says so, so a technician does not mistake it
  // for an answer to live work.
  const lateStatus = ['resolved', 'closed', 'cancelled'].includes(request.status) ? request.status : null
  await logActivity({ requestId, actorId: actorProfileId, action: 'comment_added', metadata: { via: 'email', ...(lateStatus ? { ticket_status: lateStatus } : {}) } })

  // Same recipients addComment() notifies for a public comment: requester + assignee +
  // collaborators, minus whoever just wrote it (only possible when they're a known portal user).
  const audience = await getRequestAudience(requestId)
  const recipients = [...new Set(
    [audience.requesterId, audience.assigneeId, ...audience.collaboratorIds]
      .filter((id): id is string => !!id && id !== actorProfileId),
  )]
  const displayName = author.name
  const notifBody = trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed
  if (recipients.length > 0) {
    notify(
      recipients.map((recipientId) => ({
        recipientId,
        actorId: actorProfileId, // null for a non-portal sender (e.g. an OEM) — the title
        // below already names them by their real name, not by a stand-in profile.
        type: 'comment_added' as const,
        title: `${displayName} replied by email`,
        body: notifBody,
        requestId,
        link: `/requests/${requestId}?tab=conversations`,
      })),
    ).catch(() => {})
  }

  // Same auto-resume addComment() does: a reply from the actual requester while the ticket
  // is Waiting on User means the wait is over.
  if (isProfileAuthor && author.profileId === request.requester_id && request.status === 'waiting_user') {
    const now = new Date()
    const update: Record<string, unknown> = { status: 'in_progress', waiting_since: null }
    if (request.waiting_since) {
      const pausedMs = now.getTime() - new Date(request.waiting_since).getTime()
      if (request.response_due_at) update.response_due_at = new Date(new Date(request.response_due_at).getTime() + pausedMs).toISOString()
      if (request.resolution_due_at) update.resolution_due_at = new Date(new Date(request.resolution_due_at).getTime() + pausedMs).toISOString()
      update.paused_ms_total = Number(request.paused_ms_total ?? 0) + pausedMs
    }
    // only while it is still waiting: a technician who has moved it on meanwhile must not be overruled (D-044)
    const { data: resumed, error: resumeError } = await admin.from('requests').update(update).eq('id', requestId).eq('status', 'waiting_user').select('id')
    if (resumeError) {
      logger.error({ event: 'email_reply.resume_failed', message: 'A requester e-mail reply could not move the ticket back to In Progress.', requestId, errorCode: resumeError.code, error: resumeError })
    } else if (resumed && resumed.length > 0) {
      // addComment() writes this history entry for the same move; without it the ticket silently changed status and the timeline did not show why.
      await logActivity({ requestId, actorId: author.profileId, action: 'status_changed', metadata: { from: 'waiting_user', to: 'in_progress', via: 'email' } })
    }
  }

  // The requester replying to a RESOLVED ticket means "it is not fixed": reopen it through the same path the screen and the e-mail link use, which checks
  // the reopen window, restarts the SLA clock and tells the technician. Outside the window the reply simply stays in the conversation. A closed or
  // cancelled ticket is never reopened by an e-mail (the history entry above carries ticket_status for that).
  if (isProfileAuthor && author.profileId === request.requester_id && request.status === 'resolved') {
    try {
      const { data: requester } = await admin
        .from('profiles')
        .select('*, team_members(team_id, is_lead, joined_at, team:teams(*))')
        .eq('id', author.profileId)
        .maybeSingle()
      if (requester) {
        const res = await applyStatusChange(
          { supabase: admin as never, profile: requester as unknown as ProfileWithTeams },
          requestId,
          'open',
          'Reopened because the requester replied by e-mail after the ticket was resolved.',
        )
        if (res.error) logger.info({ event: 'email_reply.reopen_skipped', message: 'A requester e-mail reply on a resolved ticket did not reopen it.', requestId, context: { reason: res.error } })
      }
    } catch (e) {
      logger.error({ event: 'email_reply.reopen_failed', message: 'Reopening a resolved ticket after a requester e-mail reply failed.', requestId, error: e })
    }
  }

  return { commentId: inserted.id }
}
