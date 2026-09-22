import { createAdminClient } from '@/lib/supabase/admin'
import { notify, getRequestAudience } from '@/lib/notifications'
import { logActivity } from '@/lib/activity'

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
  await logActivity({ requestId, actorId: actorProfileId, action: 'comment_added', metadata: { via: 'email' } })

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
    await admin.from('requests').update(update).eq('id', requestId)
  }

  return { commentId: inserted.id }
}
