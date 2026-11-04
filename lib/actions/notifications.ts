'use server'

import { sanitizeError } from '@/lib/observability/sanitize-error'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { Constants } from '@/types/database'

type ActionResult = { error?: string }

// ── Mark single notification read ─────────────────────────────────────────────

export async function markNotificationRead(
  notificationId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', profile.id)
    .is('read_at', null)

  if (error) return { error: sanitizeError(error, { route: 'notifications.ts', fallback: 'Something went wrong. Please try again.' }) }

  revalidatePath('/notifications')
  return {}
}

// ── Mark all notifications read ───────────────────────────────────────────────

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', profile.id)
    .is('read_at', null)
    .is('archived_at', null)

  if (error) return { error: sanitizeError(error, { route: 'notifications.ts', fallback: 'Something went wrong. Please try again.' }) }

  revalidatePath('/notifications')
  revalidatePath('/home')
  return {}
}

// ── Mark every notification about one request as read ──────────────────────────
// Opening a ticket and seeing its status/conversation already IS reading whatever it
// was notified about — the bell shouldn't still say "unread" for something the person
// is looking straight at. Scoped to the caller's own notifications for this request
// only, so viewing one ticket never touches anyone else's or any other ticket's.

export async function markRequestNotificationsRead(requestId: string): Promise<ActionResult & { updated?: number }> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', profile.id)
    .eq('request_id', requestId)
    .is('read_at', null)
    .is('archived_at', null)
    .select('id')

  if (error) return { error: sanitizeError(error, { route: 'notifications.ts', fallback: 'Something went wrong. Please try again.' }) }
  if (data.length === 0) return { updated: 0 }

  revalidatePath('/notifications')
  revalidatePath('/home')
  return { updated: data.length }
}

// ── Archive notification ──────────────────────────────────────────────────────

export async function archiveNotification(
  notificationId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('notifications')
    .update({ archived_at: now, read_at: now })
    .eq('id', notificationId)
    .eq('user_id', profile.id)

  if (error) return { error: sanitizeError(error, { route: 'notifications.ts', fallback: 'Something went wrong. Please try again.' }) }

  revalidatePath('/notifications')
  return {}
}

// ── Clear all (archive everything) with undo ─────────────────────────────────
// "Clear all" moves every notification of the signed-in person to Archived (nothing is deleted; the Archived tab of the Notifications page still lists them). It returns what it
// changed so the screen can offer Undo for a few seconds; Undo puts back exactly those and nothing else (only rows archived in that very action, only the person's own).
// The bell does not list approval requests (they have their own bell), so its "Clear all" leaves them alone (excludeApprovalRequests); the Notifications page lists them and clears them too.

const CLEAR_ALL_MAX = 1000
const CHUNK = 200

export async function archiveAllNotifications(opts: { excludeApprovalRequests?: boolean } = {}): Promise<ActionResult & { archivedAt?: string; ids?: string[]; unreadIds?: string[] }> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  let q = supabase.from('notifications').select('id, read_at').eq('user_id', profile.id).is('archived_at', null)
  if (opts.excludeApprovalRequests) q = q.neq('type', 'approval_requested')
  const { data, error } = await q.limit(CLEAR_ALL_MAX)
  if (error) return { error: sanitizeError(error, { route: 'notifications.ts#archiveAll', fallback: 'Something went wrong. Please try again.' }) }
  const rows = (data ?? []) as { id: string; read_at: string | null }[]
  if (rows.length === 0) return { archivedAt: new Date().toISOString(), ids: [], unreadIds: [] }

  const now = new Date().toISOString()
  const ids = rows.map((r) => r.id)
  const unreadIds = rows.filter((r) => !r.read_at).map((r) => r.id)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error: e1 } = await supabase.from('notifications').update({ archived_at: now }).in('id', ids.slice(i, i + CHUNK)).eq('user_id', profile.id).is('archived_at', null)
    if (e1) return { error: sanitizeError(e1, { route: 'notifications.ts#archiveAll', fallback: 'Something went wrong. Please try again.' }) }
  }
  for (let i = 0; i < unreadIds.length; i += CHUNK) {
    const { error: e2 } = await supabase.from('notifications').update({ read_at: now }).in('id', unreadIds.slice(i, i + CHUNK)).eq('user_id', profile.id).is('read_at', null)
    if (e2) return { error: sanitizeError(e2, { route: 'notifications.ts#archiveAll', fallback: 'Something went wrong. Please try again.' }) }
  }

  revalidatePath('/notifications')
  revalidatePath('/home')
  return { archivedAt: now, ids, unreadIds }
}

/** Undo of archiveAllNotifications: brings back the notifications archived in that action (same time stamp), and makes the ones that were unread unread again. */
export async function restoreArchivedNotifications(p: { archivedAt: string; ids: string[]; unreadIds: string[] }): Promise<ActionResult & { restored?: number }> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.length <= CLEAR_ALL_MAX && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 64)
  if (typeof p?.archivedAt !== 'string' || Number.isNaN(Date.parse(p.archivedAt)) || !isIds(p.ids) || !isIds(p.unreadIds)) return { error: 'Nothing to undo.' }
  if (p.ids.length === 0) return { restored: 0 }

  let restored = 0
  for (let i = 0; i < p.ids.length; i += CHUNK) {
    const { data, error } = await supabase.from('notifications').update({ archived_at: null }).in('id', p.ids.slice(i, i + CHUNK)).eq('user_id', profile.id).eq('archived_at', p.archivedAt).select('id')
    if (error) return { error: sanitizeError(error, { route: 'notifications.ts#restoreArchived', fallback: 'Something went wrong. Please try again.' }) }
    restored += data?.length ?? 0
  }
  // only the ones this action marked read (their read time is the action's time stamp) become unread again; one the person read later stays read
  for (let i = 0; i < p.unreadIds.length; i += CHUNK) {
    const { error } = await supabase.from('notifications').update({ read_at: null }).in('id', p.unreadIds.slice(i, i + CHUNK)).eq('user_id', profile.id).eq('read_at', p.archivedAt)
    if (error) return { error: sanitizeError(error, { route: 'notifications.ts#restoreArchived', fallback: 'Something went wrong. Please try again.' }) }
  }

  revalidatePath('/notifications')
  revalidatePath('/home')
  return { restored }
}

// ── Update notification preference ────────────────────────────────────────────

export async function setNotificationPreference(
  eventType: string,
  enabled: boolean
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  // Only the notification types that exist (the database's own list) can be switched off or on. This used to store any text the browser sent, so a
  // user could fill the table with arbitrary rows of any length.
  if (typeof eventType !== 'string' || eventType.length > 64 || !(Constants.public.Enums.notification_type as readonly string[]).includes(eventType)) {
    return { error: 'Unknown notification type.' }
  }
  if (typeof enabled !== 'boolean') return { error: 'Invalid setting.' }

  // Written by the server for the signed-in person only (their own row): a database built from the migrations gives the user's own session no write right here.
  const { error } = await createAdminClient()
    .from('notification_preferences')
    .upsert({ user_id: profile.id, event_type: eventType, enabled })

  if (error) return { error: sanitizeError(error, { route: 'notifications.ts', fallback: 'Something went wrong. Please try again.' }) }
  return {}
}
