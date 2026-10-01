import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getTaskTemplates, getTaskStatuses, getTaskPriorities } from '@/lib/queries/admin'
import { TaskConfigClient } from './TaskConfigClient'
import { PageHeader } from '@/components/ui/PageHeader'

export default async function TaskConfigPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  // An admin/manager can oversee several teams — templates for all of them
  // should be visible here, not just the first. A single "primary" team is
  // still needed for creating a NEW template, which targets exactly one team.
  const teamIds = profile.team_members.map(tm => tm.team_id)
  const primaryTeamId = teamIds[0] ?? null

  const [templates, statuses, priorities] = await Promise.all([
    getTaskTemplates(teamIds),
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
        teamId={primaryTeamId}
      />
    </div>
  )
}
