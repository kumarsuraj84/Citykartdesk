import { redirect } from 'next/navigation'
import { TechnicianDashboard } from '@/components/analytics/TechnicianDashboard'
import { getAnalytics } from '@/lib/queries/analytics'
import { getTechnicianWorkloadBoard } from '@/lib/queries/requests'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { resolveReportAccess } from '@/lib/reporting/access'

// The Technician-tier "Dashboards" page. It lives outside /admin because
// app/(app)/admin/layout.tsx redirects every role but admin/manager/platform_owner
// to /home — which is what made the sidebar's Dashboards link bounce technicians.
export default async function TechnicianDashboardPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/admin/reports')
  if (profile.role !== 'agent') redirect('/home')

  const access = resolveReportAccess(profile, 'requests')
  if ('error' in access) redirect('/home')

  const [analytics, workload] = await Promise.all([
    getAnalytics(profile.org_id, '30d'),
    getTechnicianWorkloadBoard(profile.org_id, access.scope),
  ])
  return (
    <TechnicianDashboard
      dailyActivity={analytics.dailyActivity}
      backlogAging={analytics.backlogAging}
      rows={workload}
    />
  )
}
