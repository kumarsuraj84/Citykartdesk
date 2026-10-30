import { redirect } from 'next/navigation'
import { getCurrentProfile, getUnreadNotificationCount } from '@/lib/queries/profiles'
import { getNotifications, type NotificationFilter } from '@/lib/queries/notifications'
import { NotificationsClient } from './NotificationsClient'

const PAGE = 50
const MAX = 500

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; limit?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  // The tab and the length of the list come from the address, so the "Archived" tab really loads archived items (the page used to load only the active ones and
  // filter in the browser, which left that tab empty for ever) and "Load more" can ask for the next page.
  const sp = await searchParams
  const filter: NotificationFilter = sp.filter === 'unread' || sp.filter === 'archived' ? sp.filter : 'all'
  const limit = Math.min(MAX, Math.max(PAGE, Math.floor(Number(sp.limit) || PAGE)))

  const [rows, unreadCount] = await Promise.all([
    getNotifications(profile.id, { filter, limit: limit + 1 }),
    getUnreadNotificationCount(profile.id),
  ])
  const hasMore = rows.length > limit

  return (
    <NotificationsClient
      initialNotifications={rows.slice(0, limit)}
      initialUnreadCount={unreadCount}
      filter={filter}
      limit={limit}
      pageSize={PAGE}
      hasMore={hasMore && limit < MAX}
    />
  )
}
