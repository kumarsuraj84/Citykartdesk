/**
 * Notification creation helpers.
 *
 * All notification writes use the admin client to bypass RLS.
 * notify() never throws — failures are logged to stderr only.
 * Callers should fire-and-forget: `notify(inputs).catch(() => {})`
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { NotificationType } from '@/types'
import type { Json } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifyInput = {
  recipientId: string
  actorId: string
  type: NotificationType
  title: string
  body?: string
  requestId?: string
  taskId?: string
  link?: string
  metadata?: Record<string, unknown>
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

  // Check notification preferences — skip opted-out recipients
  const recipientIds = [...new Set(rows.map((r) => r.recipientId))]

  const { data: optedOut } = await admin
    .from('notification_preferences')
    .select('user_id, event_type')
    .in('user_id', recipientIds)
    .eq('enabled', false)

  const optedOutKeys = new Set(
    (optedOut ?? []).map((o) => `${o.user_id}:${o.event_type}`)
  )

  const filtered = rows.filter(
    (r) => !optedOutKeys.has(`${r.recipientId}:${r.type}`)
  )
  if (filtered.length === 0) return

  const notificationRows = filtered.map(
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
    console.error('[notify] Insert failed', error.message)
  }

  ;(async () => { try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { sendNotificationEmail } = await import('@/lib/email/notify-email')
    const adminClient = createAdminClient()
    // Independent per-recipient — was one at a time (an N-recipient notify(),
    // e.g. a Business Rule notifying every manager, took N sequential round
    // trips). Each attempt is caught individually so one bad address can't
    // stop the rest from sending, which the old sequential loop's single
    // outer catch would have done (an earlier failure aborted every
    // recipient still queued behind it).
    await Promise.all(notificationRows.map(async (n) => {
      try {
        const { data: u } = await adminClient.auth.admin.getUserById(n.user_id)
        if (!u?.user?.email) return
        await sendNotificationEmail({ type: n.type, recipientEmail: u.user.email, recipientName: '', data: { ...(n.metadata as Record<string, string> ?? {}), title: n.title, body: n.body ?? '', link: n.link ?? '' } })
      } catch { /* isolated per recipient */ }
    }))
  } catch {} })()
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
