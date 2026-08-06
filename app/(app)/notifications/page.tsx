import { redirect } from 'next/navigation'
import { getCurrentProfile, getUnreadNotificationCount } from '@/lib/queries/profiles'
import { getNotifications } from '@/lib/queries/notifications'
import { NotificationsClient } from './NotificationsClient'

export default async function NotificationsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(profile.id, { limit: 50 }),
    getUnreadNotificationCount(profile.id),
  ])

  return (
    <NotificationsClient
      initialNotifications={notifications}
      initialUnreadCount={unreadCount}
    />
  )
}
