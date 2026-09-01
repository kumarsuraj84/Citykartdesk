import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportTasks } from '@/lib/actions/export'
import { getTasks, getAllProfiles, getCustomFields, getCustomFieldValues } from '@/lib/queries/tasks'
import { getAllProjectsMini } from '@/lib/queries/projects'
import { NewTaskPanel } from '@/components/tasks/NewTaskPanel'
import { TasksClient } from './TasksClient'
import { Pagination } from '@/components/ui/Pagination'

interface PageProps {
  searchParams: Promise<{ filter?: string; task?: string; view?: string; page?: string; pageSize?: string }>
}

export default async function TasksPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // Tasks isn't fully built out yet — Admin/Owner only until that work ships.
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const params = await searchParams
  const filter = (params.filter ?? 'my_tasks') as
    | 'my_tasks' | 'assigned_me' | 'created_by_me' | 'team' | 'all'
    | 'due_today' | 'overdue' | 'done_week' | 'team_overdue'

  const page     = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const rawPageSize = parseInt(params.pageSize ?? '50', 10)
  const pageSize = [25, 50, 100].includes(rawPageSize) ? rawPageSize : 50

  const teamId = profile.team_members[0]?.team_id ?? null

  const [taskResult, profiles, customFields, allProjects] = await Promise.all([
    getTasks({ userId: profile.id, filter, teamId: teamId ?? undefined, page, pageSize }),
    getAllProfiles(),
    teamId ? getCustomFields(teamId) : Promise.resolve([]),
    getAllProjectsMini(),
  ])

  const tasks = taskResult.data

  const customFieldValues = tasks.length > 0 && customFields.length > 0
    ? await getCustomFieldValues(tasks.map(t => t.id))
    : {}

  return (
    <div className="flex flex-col gap-2">
      <TasksClient
        tasks={tasks}
        profiles={profiles}
        currentUserId={profile.id}
        currentUserName={profile.full_name ?? 'You'}
        initialTaskId={params.task}
        teamId={teamId}
        initialCustomFields={customFields}
        initialCustomFieldValues={customFieldValues}
        allProjects={allProjects}
        toolbarActions={
          <>
            <ExportButton action={exportTasks} filename="tasks.csv" />
            <NewTaskPanel profiles={profiles} allProjects={allProjects} />
          </>
        }
      />

      <Suspense>
        <Pagination
          page={taskResult.page}
          totalPages={taskResult.totalPages}
          total={taskResult.total}
          pageSize={taskResult.pageSize}
          basePath="/tasks"
        />
      </Suspense>
    </div>
  )
}
