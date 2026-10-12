/**
 * Notification creation helpers.
 *
 * All notification writes use the admin client to bypass RLS.
 * notify() never throws — failures are logged to stderr only.
 * Callers should fire-and-forget: `notify(inputs).catch(() => {})`
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/observability/logger'
import { alertOperator } from '@/lib/observability/alert'
import type { NotificationType } from '@/types'
import type { Json } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifyInput = {
  recipientId: string
  /** Nullable for a notification with no real portal actor (e.g. an emailed reply from
   *  someone with no Citykart Desk account) — the column has always allowed this; the
   *  title/body text is what actually names who did it. */
  actorId: string | null
  type: NotificationType
  title: string
  body?: string
  requestId?: string
  taskId?: string
  link?: string
  metadata?: Record<string, unknown>
  /** Show in the bell only, never e-mail (used when a better e-mail already went out, e.g. the resolved + rating e-mail). */
  skipEmail?: boolean
}

// ── notify() ──────────────────────────────────────────────────────────────────

/**
 * Insert one or more notification rows.
 *
 * Preference check: if a user has opted out of a specific event_type,
 * their row is silently skipped.
 *
 * Returns without throwing even on DB failure.
 */
export async function notify(inputs: NotifyInput | NotifyInput[]): Promise<void> {
  const rows = Array.isArray(inputs) ? inputs : [inputs]
  if (rows.length === 0) return

  const admin = createAdminClient()

  // Check notification preferences — skip opted-out recipients. This is the
  // per-user blanket veto ("stop telling me about X at all"); the org-level
  // per-channel rules below are a separate, admin-facing layer on top.
  const recipientIds = [...new Set(rows.map((r) => r.recipientId))]

  const [{ data: optedOut }, { data: recipientProfiles }] = await Promise.all([
    admin
      .from('notification_preferences')
      .select('user_id, event_type')
      .in('user_id', recipientIds)
      .eq('enabled', false),
    admin.from('profiles').select('id, org_id, full_name').in('id', recipientIds),
  ])

  const optedOutKeys = new Set(
    (optedOut ?? []).map((o) => `${o.user_id}:${o.event_type}`)
  )
  const nameByUser = new Map(
    (recipientProfiles ?? []).map((p) => [p.id, (p as { full_name?: string | null }).full_name ?? ''])
  )
  const orgByUser = new Map(
    (recipientProfiles ?? []).map((p) => [p.id, p.org_id as string | null])
  )

  const active = rows.filter(
    (r) => !optedOutKeys.has(`${r.recipientId}:${r.type}`)
  )
  if (active.length === 0) return

  // Give every email the ticket number and the real ticket title (the notification's own title is a
  // sentence like "Request assigned to you", which made a poor subject line).
  const requestIds = [...new Set(active.map((r) => r.requestId).filter((v): v is string => !!v))]
  const requestInfo = new Map<string, { request_no: string | null; title: string; requester_name: string }>()
  if (requestIds.length > 0) {
    const { data: reqRows } = await admin.from('requests').select('id, request_no, title, requester:profiles!requests_requester_id_fkey(full_name)').in('id', requestIds)
    for (const q of (reqRows ?? []) as unknown as { id: string; request_no: string | null; title: string; requester: { full_name: string } | { full_name: string }[] | null }[]) {
      const who = Array.isArray(q.requester) ? q.requester[0] : q.requester
      requestInfo.set(q.id, { request_no: q.request_no, title: q.title, requester_name: who?.full_name ?? '' })
    }
  }
  // who did it (the sender), for e-mails that say "X sent this to you"
  const actorIds = [...new Set(active.map((r) => r.actorId).filter((v): v is string => !!v))]
  const actorNameById = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: actorRows } = await admin.from('profiles').select('id, full_name').in('id', actorIds)
    for (const a of (actorRows ?? []) as { id: string; full_name: string | null }[]) actorNameById.set(a.id, a.full_name ?? '')
  }

  // Org-level channel toggles (Request Configuration → Notification Rules).
  // No row for a given (org, event_type) means every channel defaults ON —
  // matches this app's always-on behavior from before this table existed,
  // so introducing it doesn't silently go quiet on anyone.
  const orgIds = [...new Set(
    active.map((r) => orgByUser.get(r.recipientId)).filter((v): v is string => !!v)
  )]
  const { data: ruleRows } = orgIds.length > 0
    ? await admin
        .from('notification_rules')
        .select('org_id, event_type, email, in_app, push')
        .in('org_id', orgIds)
    : { data: [] as { org_id: string; event_type: string; email: boolean; in_app: boolean; push: boolean }[] }
  const ruleByKey = new Map(
    (ruleRows ?? []).map((r) => [`${r.org_id}:${r.event_type}`, r])
  )

  function channelsFor(r: NotifyInput) {
    const orgId = orgByUser.get(r.recipientId)
    const rule = orgId ? ruleByKey.get(`${orgId}:${r.type}`) : undefined
    return {
      inApp: rule?.in_app ?? true,
      email: rule?.email ?? true,
      push:  rule?.push  ?? true,
    }
  }

  // In-app (the notifications bell)
  const inAppTargets = active.filter((r) => channelsFor(r).inApp)
  if (inAppTargets.length > 0) {
    const notificationRows = inAppTargets.map(
      ({ recipientId, actorId, type, title, body, requestId, taskId, link, metadata }) => ({
        user_id:    recipientId,
        actor_id:   actorId,
        type,
        title,
        body:       body       ?? null,
        request_id: requestId  ?? null,
        task_id:    taskId     ?? null,
        link:       link       ?? null,
        metadata:   (metadata  ?? {}) as Json,
      })
    )
    const { error } = await admin.from('notifications').insert(notificationRows)
    if (error) {
      // DESK-OBS-002: previously a bare console.error with no ids/context —
      // a bulk in-app insert failure (e.g. a bad request_id/task_id FK on
      // one row in the batch failing the whole insert) was effectively
      // invisible outside a live terminal.
      logger.error({
        event: 'notifications.in_app_insert_failed',
        message: 'Bulk in-app notification insert failed',
        route: 'lib/notifications.ts#notify',
        errorCode: 'notify_in_app_insert_failed',
        context: { recipientCount: inAppTargets.length, types: [...new Set(inAppTargets.map((r) => r.type))] },
        error,
      })
    }
  }

  // Email — a team-broadcast notification (e.g. "new request in the queue" sent to every
  // team member) is deliberately in-app only, regardless of the Notification Rules toggle;
  // see the audience: 'team' callers.
  const emailTargets = active.filter((r) => !r.skipEmail && channelsFor(r).email && (r.metadata as { audience?: string } | undefined)?.audience !== 'team')
  if (emailTargets.length > 0) {
    ;(async () => { try {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const { sendNotificationEmail } = await import('@/lib/email/notify-email')
      const adminClient = createAdminClient()
      // An approver's e-mail gets Approve / Reject buttons: find the approval that is waiting on this request.
      const approvalByRequest = new Map<string, string>()
      const approvalRequestIds = [...new Set(emailTargets.filter((r) => r.type === 'approval_requested' && r.requestId).map((r) => r.requestId as string))]
      if (approvalRequestIds.length > 0) {
        const { data: pendingApprovals } = await adminClient.from('approvals').select('id, request_id, created_at').in('request_id', approvalRequestIds).eq('status', 'pending').order('created_at', { ascending: true })
        for (const a of (pendingApprovals ?? []) as { id: string; request_id: string }[]) approvalByRequest.set(a.request_id, a.id) // newest wins
      }
      // Independent per-recipient — an N-recipient notify() (e.g. a Business
      // Rule notifying every manager) fans out in parallel instead of one at
      // a time, and each attempt is caught individually so one bad address
      // can't stop the rest from sending.
      // DESK-OBS-002: every per-recipient failure used to be swallowed with
      // no trace at all (`catch { /* isolated per recipient */ }`) — the
      // isolation itself was correct (one bad recipient shouldn't block the
      // rest), but "isolated" had come to also mean "unobservable." Each
      // failure is now counted and structured-logged once as an aggregate,
      // and an operator is alerted if every recipient in the batch failed
      // (a single bad address isn't page-worthy; a 100% failure rate is).
      let failedCount = 0
      await Promise.all(emailTargets.map(async (r) => {
        try {
          const { data: u } = await adminClient.auth.admin.getUserById(r.recipientId)
          if (!u?.user?.email) return
          const res = await sendNotificationEmail({
            type: r.type,
            recipientEmail: u.user.email,
            recipientName: (nameByUser.get(r.recipientId) ?? '').split(' ')[0],
            data: {
              ...(r.requestId && requestInfo.get(r.requestId)
                ? { requestNo: requestInfo.get(r.requestId)!.request_no ?? '', requestTitle: requestInfo.get(r.requestId)!.title, ...(requestInfo.get(r.requestId)!.requester_name ? { requesterName: requestInfo.get(r.requestId)!.requester_name } : {}) }
                : {}),
              ...(r.actorId && actorNameById.get(r.actorId) ? { actorName: actorNameById.get(r.actorId)! } : {}),
              ...(r.type === 'approval_requested' && r.requestId && approvalByRequest.get(r.requestId) ? { approvalId: approvalByRequest.get(r.requestId)!, approverId: r.recipientId } : {}),
              ...(r.metadata as Record<string, string> ?? {}),
              title: r.title, body: r.body ?? '', link: r.link ?? '',
            },
          })
          if (res.error) failedCount++
        } catch {
          failedCount++
        }
      }))
      if (failedCount > 0) {
        logger.error({
          event: 'notifications.email_failed',
          message: `${failedCount}/${emailTargets.length} notification emails failed to send`,
          route: 'lib/notifications.ts#notify',
          errorCode: 'notify_email_failed',
          context: { failedCount, totalCount: emailTargets.length, types: [...new Set(emailTargets.map((r) => r.type))] },
        })
        if (failedCount === emailTargets.length) {
          await alertOperator({
            key: `notifications.email_total_failure.${emailTargets[0].type}`,
            severity: 'critical',
            title: `All ${failedCount} notification email(s) of type "${emailTargets[0].type}" failed to send`,
            detail: { failedCount, type: emailTargets[0].type },
          })
        }
      }
    } catch (err) {
      logger.error({
        event: 'notifications.email_dispatch_crashed',
        message: 'Notification email dispatch threw before per-recipient isolation could apply',
        route: 'lib/notifications.ts#notify',
        errorCode: 'notify_email_dispatch_crashed',
        error: err,
      })
    } })()
  }

  // Push
  const pushTargets = active.filter((r) => channelsFor(r).push)
  if (pushTargets.length > 0) {
    ;(async () => { try {
      const { sendPushToUser } = await import('@/lib/push/send')
      let failedCount = 0
      await Promise.all(pushTargets.map(async (r) => {
        try {
          await sendPushToUser(r.recipientId, { title: r.title, body: r.body ?? '', link: r.link ?? '/notifications' })
        } catch {
          failedCount++
        }
      }))
      if (failedCount > 0) {
        logger.warn({
          event: 'notifications.push_failed',
          message: `${failedCount}/${pushTargets.length} push notifications failed to send`,
          route: 'lib/notifications.ts#notify',
          errorCode: 'notify_push_failed',
          context: { failedCount, totalCount: pushTargets.length },
        })
      }
    } catch (err) {
      logger.warn({
        event: 'notifications.push_dispatch_crashed',
        message: 'Push notification dispatch threw before per-recipient isolation could apply',
        route: 'lib/notifications.ts#notify',
        errorCode: 'notify_push_dispatch_crashed',
        error: err,
      })
    } })()
  }
}

// ── getRequestAudience() ──────────────────────────────────────────────────────

/**
 * Fetch requester_id, assigned_to, and collaborator user_ids for a request.
 * Uses admin client so it works from any server action context.
 */
export async function getRequestAudience(requestId: string): Promise<{
  requesterId: string
  assigneeId: string | null
  collaboratorIds: string[]
}> {
  const admin = createAdminClient()

  const [{ data: req }, { data: collabs }] = await Promise.all([
    admin.from('requests').select('requester_id, assigned_to').eq('id', requestId).single(),
    admin.from('request_collaborators').select('user_id').eq('request_id', requestId),
  ])

  return {
    requesterId:     req?.requester_id ?? '',
    assigneeId:      req?.assigned_to  ?? null,
    collaboratorIds: (collabs ?? []).map((c) => c.user_id),
  }
}

// ── parseMentions() ───────────────────────────────────────────────────────────

/**
 * Extract @FirstName tokens from a comment body.
 * Returns de-duplicated lowercase first-name strings.
 */
export function parseMentions(body: string): string[] {
  const pattern = /@(\w+)/g
  const found = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = pattern.exec(body)) !== null) {
    found.add(m[1].toLowerCase())
  }
  return [...found]
}
