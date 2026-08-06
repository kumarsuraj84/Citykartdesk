import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getMonitoringStats, getRecentActivity } from '@/lib/queries/admin'
import { MonitoringClient } from './MonitoringClient'

export default async function MonitoringPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const [stats, recentActivity] = await Promise.all([
    getMonitoringStats(),
    getRecentActivity(10),
  ])

  return (
    <MonitoringClient
      stats={stats}
      recentActivity={recentActivity}
    />
  )
}
