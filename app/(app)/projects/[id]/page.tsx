import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile, getAllProfiles } from '@/lib/queries/profiles'
import {
  getProjectById,
  getProjectProgress,
  getProjectActivity,
  getAllProjectsMini,
  getMilestonesForProject,
  getMilestoneProgress,
  getProjectMembers,
  getProjectUpdates,
} from '@/lib/queries/projects'
import { getTasksForProject, getCustomFields, getCustomFieldValues } from '@/lib/queries/tasks'
import { getRequestsForProject } from '@/lib/queries/requests'
import { ProjectHeader } from '@/components/projects/ProjectHeader'
import { ProjectRequestsList } from '@/components/projects/ProjectRequestsList'
import { MilestoneTable } from '@/components/projects/MilestoneTable'
import { NewMilestonePanel } from '@/components/projects/NewMilestonePanel'
import { ProjectUpdatesTab } from '@/components/projects/ProjectUpdatesTab'
import { ProjectDetailTabs } from '@/components/projects/ProjectDetailTabs'
import { TasksClient } from '@/app/(app)/tasks/TasksClient'
import { NewTaskPanel } from '@/components/tasks/NewTaskPanel'
import { formatRelativeTime } from '@/lib/utils'
import { computeProjectProgressPct } from '@/lib/projects/progress'
import type { ProjectProgress } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'created this project',
  status_changed: 'changed the status',
  archived: 'archived this project',
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // Projects isn't fully built out yet — Admin/Owner only until that work ships.
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const project = await getProjectById(id)
  if (!project) notFound()

  // Page is already Admin/Owner-only (redirect above) — both are manager-tier.
  const isManager = true

  const [progress, tasks, requests, activity, profiles, allProjects, milestones, members, updates] = await Promise.all([
    getProjectProgress(id),
    getTasksForProject(id),
    getRequestsForProject(id),
    getProjectActivity(id),
    getAllProfiles(),
    getAllProjectsMini(),
    getMilestonesForProject(id),
    getProjectMembers(id),
    getProjectUpdates(id),
  ])

  const customFields = project.team_id ? await getCustomFields(project.team_id) : []
  const customFieldValues =
    tasks.length > 0 && customFields.length > 0
      ? await getCustomFieldValues(tasks.map((t) => t.id))
      : {}

  const progressByMilestone: Record<string, ProjectProgress> = {}
  await Promise.all(
    milestones.map(async (m) => {
      progressByMilestone[m.id] = await getMilestoneProgress(m.id)
    })
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Project"
        breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: project.name }]}
      />

      <ProjectHeader project={project} progress={progress} members={members} allProfiles={profiles} />

      <ProjectDetailTabs
        taskCount={tasks.length}
        requestCount={requests.length}
        milestoneCount={milestones.length}
        updateCount={updates.length}
        activityCount={activity.length}
        tasks={
          <TasksClient
            tasks={tasks}
            profiles={profiles}
            currentUserId={profile.id}
            currentUserName={profile.full_name ?? 'You'}
            teamId={project.team_id}
            initialCustomFields={customFields}
            initialCustomFieldValues={customFieldValues}
            basePath={`/projects/${id}`}
            hideFilter
            allProjects={allProjects}
            milestones={milestones.map((m) => ({ id: m.id, name: m.name }))}
            projectId={id}
            toolbarActions={<NewTaskPanel key={id} profiles={profiles} defaultProjectId={id} />}
          />
        }
        requests={<ProjectRequestsList requests={requests} />}
        milestones={
          <div className="space-y-3">
            <div className="flex items-center justify-end">
              <NewMilestonePanel projectId={id} />
            </div>
            <MilestoneTable
              milestones={milestones}
              progressByMilestone={progressByMilestone}
              projectId={id}
              profiles={profiles}
            />
          </div>
        }
        updates={
          <ProjectUpdatesTab
            projectId={id}
            updates={updates}
            currentUserId={profile.id}
            isManager={isManager}
            currentProgressPct={computeProjectProgressPct(project.status, progress)}
          />
        }
        activity={
          activity.length > 0 ? (
            <div className="divide-y divide-border rounded-lg border border-border">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{a.actor?.full_name ?? 'Someone'}</span>
                  {ACTIVITY_LABELS[a.action] ?? a.action}
                  <span className="text-muted-foreground/50">·</span>
                  {formatRelativeTime(a.created_at)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          )
        }
      />
    </div>
  )
}
