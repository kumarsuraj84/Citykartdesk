'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'

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

  if (error) return { error: error.message }

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

  if (error) return { error: error.message }

  revalidatePath('/notifications')
  revalidatePath('/home')
  return {}
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

  if (error) return { error: error.message }

  revalidatePath('/notifications')
  return {}
}

// ── Update notification preference ────────────────────────────────────────────

export async function setNotificationPreference(
  eventType: string,
  enabled: boolean
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: profile.id, event_type: eventType, enabled })

  if (error) return { error: error.message }
  return {}
}
