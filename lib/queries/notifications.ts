import { createClient } from '@/lib/supabase/server'
import type { NotificationWithActor } from '@/types'

export type NotificationFilter = 'all' | 'unread' | 'archived'

export async function getNotifications(
  userId: string,
  opts: {
    filter?: NotificationFilter
    limit?: number
    offset?: number
  } = {}
): Promise<NotificationWithActor[]> {
  const supabase = await createClient()
  const { filter = 'all', limit = 30, offset = 0 } = opts

  let query = supabase
    .from('notifications')
    .select('*, actor:profiles!notifications_actor_id_fkey (id, full_name, avatar_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filter === 'unread') {
    query = query.is('read_at', null).is('archived_at', null)
  } else if (filter === 'archived') {
    query = query.not('archived_at', 'is', null)
  } else {
    query = query.is('archived_at', null)
  }

  const { data } = await query
  return (data ?? []) as unknown as NotificationWithActor[]
}
