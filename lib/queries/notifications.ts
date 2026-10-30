import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/observability/logger'
import type { NotificationWithActor } from '@/types'

export type NotificationFilter = 'all' | 'unread' | 'archived'

export async function getNotifications(
  userId: string,
  opts: {
    filter?: NotificationFilter
    limit?: number
    offset?: number
    /** leave these kinds out (the approvals bell lists approval requests itself) */
    excludeTypes?: string[]
  } = {}
): Promise<NotificationWithActor[]> {
  const supabase = await createClient()
  const { filter = 'all', limit = 30, offset = 0, excludeTypes = [] } = opts

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

  if (excludeTypes.length > 0) query = query.not('type', 'in', `(${excludeTypes.map((t) => `"${t}"`).join(',')})`)

  const { data, error } = await query
  // A failed read used to look exactly like "no notifications". It is still an empty list for the caller (the bell must not break a page), but it is logged.
  if (error) logger.error({ event: 'notifications.read_failed', message: 'The notification list could not be read.', actorId: userId, errorCode: error.code, error })
  return (data ?? []) as unknown as NotificationWithActor[]
}
