import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getTaskTemplates, getTaskStatuses, getTaskPriorities } from '@/lib/queries/admin'
import { TaskConfigClient } from './TaskConfigClient'
import { PageHeader } from '@/components/ui/PageHeader'

export default async function TaskConfigPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const teamId = profile.team_members[0]?.team_id ?? null

  const [templates, statuses, priorities] = await Promise.all([
    getTaskTemplates(teamId ?? undefined),
    getTaskStatuses(),
    getTaskPriorities(),
  ])

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader
        title="Task Configuration"
        description="Manage task statuses, priorities, and reusable task templates."
      />
      <TaskConfigClient
        initialStatuses={statuses}
        initialPriorities={priorities}
        initialTemplates={templates}
        teamId={teamId}
      />
    </div>
  )
}
