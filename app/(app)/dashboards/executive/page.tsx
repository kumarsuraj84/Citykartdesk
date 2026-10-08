import { redirect } from 'next/navigation'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { loadExecutiveData } from '@/lib/queries/executive-dashboard'
import { levelFor } from '@/lib/reporting/executive/levels'
import { ExecutiveDashboard } from '@/components/executive/ExecutiveDashboard'

// The interactive dashboard: every number, bar and name is clickable (it filters the whole page), and a
// popup lets the viewer drill down level by level to a single ticket. Everyone gets it, narrowed to their
// own level (see lib/reporting/executive/levels.ts).
export default async function ExecutiveDashboardPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id || !levelFor(profile.role)) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  const data = await loadExecutiveData(profile)
  if ('error' in data) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">{data.error}</p>
      </div>
    )
  }

  return (
    <ExecutiveDashboard
      level={data.level}
      me={data.me}
      now={data.now}
      tickets={data.tickets}
      approvals={data.approvals}
      truncated={data.truncated}
    />
  )
}
