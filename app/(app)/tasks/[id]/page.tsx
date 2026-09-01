import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import {
  getTaskById, getTaskComments, getTaskActivity, getSubtasks, getAllProfiles,
  getTaskAssignees, getTaskAttachments, getTaskIntakeContext, getTaskDependencies,
} from '@/lib/queries/tasks'

// This page provides a shareable direct URL for a task.
// It renders the TaskDetailPanel in a centered layout (not as a slide-over).

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TaskDetailPage({ params }: PageProps) {
  const { id } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // Tasks isn't fully built out yet — Admin/Owner only until that work ships.
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const task = await getTaskById(id)
  if (!task) notFound()

  const [comments, activity, subtasks, dependencies, profiles, assignees, attachments, intakeContext] = await Promise.all([
    getTaskComments(id),
    getTaskActivity(id),
    getSubtasks(id),
    getTaskDependencies(id),
    getAllProfiles(),
    getTaskAssignees(id),
    getTaskAttachments(id),
    getTaskIntakeContext((task as { intake_message_id?: string | null }).intake_message_id ?? null),
  ])

  return (
    <div className="space-y-3">
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Tasks
      </Link>

      <TaskDetailInline
        task={task}
        comments={comments}
        activity={activity}
        subtasks={subtasks}
        dependencies={dependencies}
        profiles={profiles}
        assignees={assignees}
        attachments={attachments}
        intakeContext={intakeContext}
        currentUserId={profile.id}
        currentUserName={profile.full_name ?? 'You'}
      />
    </div>
  )
}

import { TaskDetailInline } from '@/components/tasks/TaskDetailInline'
