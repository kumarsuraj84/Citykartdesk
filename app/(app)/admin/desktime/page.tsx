import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getAllProjectsMini } from '@/lib/queries/projects'
import {
  getDeskTimeConnected, getAiApplications, getDeskTimeProjectMap,
  getDeskTimeAppLogs, getDeskTimeMemberProjectHours, getDeskTimeLastSync,
} from '@/lib/queries/desktime'
import { DeskTimeClient } from './DeskTimeClient'

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - (days - 1))
  return d.toISOString().slice(0, 10)
}

export default async function DeskTimePage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner') redirect('/home')
  if (!profile.org_id) redirect('/home')

  const orgId = profile.org_id
  const connected = await getDeskTimeConnected(orgId)

  return (
    <div className="space-y-4">
      <PageHeader title="DeskTime" description="Team time-tracking, application hours, and project mapping." />

      {!connected ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-5 py-4 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            DeskTime is not connected yet. Add your API key in{' '}
            <Link href="/admin/settings" className="font-medium underline">Settings → Integrations</Link>.
          </p>
        </div>
      ) : (
        <ConnectedDeskTime orgId={orgId} isAdmin={profile.role === 'admin' || profile.role === 'platform_owner'} />
      )}
    </div>
  )
}

async function ConnectedDeskTime({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const from = isoDaysAgo(90)
  const to = isoDaysAgo(1) // today, UTC-anchored

  const [aiApplications, projectMap, allProjects, appLogs, memberProjectLogs, lastSync] = await Promise.all([
    getAiApplications(orgId),
    getDeskTimeProjectMap(orgId),
    getAllProjectsMini(),
    getDeskTimeAppLogs(orgId, from, to),
    getDeskTimeMemberProjectHours(orgId, from, to),
    getDeskTimeLastSync(orgId),
  ])

  return (
    <DeskTimeClient
      appLogs={appLogs}
      memberProjectLogs={memberProjectLogs}
      aiApplications={aiApplications}
      projectMap={projectMap}
      allProjects={allProjects}
      lastSync={lastSync}
      isAdmin={isAdmin}
    />
  )
}
