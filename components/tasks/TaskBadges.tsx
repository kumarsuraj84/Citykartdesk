import type { TaskStatus, TaskPriority } from '@/types'
import { TASK_PRIORITY_LABELS } from '@/lib/constants/tasks'

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const classes: Record<TaskStatus, string> = {
    open:        'bg-blue-100 text-blue-700',
    in_progress: 'bg-amber-100 text-amber-700',
    done:        'bg-emerald-100 text-emerald-700',
    cancelled:   'bg-slate-100 text-slate-500',
  }
  const labels: Record<TaskStatus, string> = {
    open:        'Open',
    in_progress: 'In Progress',
    done:        'Done',
    cancelled:   'Cancelled',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes[status]}`}>
      {labels[status]}
    </span>
  )
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const classes: Record<TaskPriority, string> = {
    high:   'bg-red-100 text-red-600',
    medium: 'bg-amber-100 text-amber-600',
    low:    'bg-slate-100 text-slate-500',
  }
  return (
    <span className={`chip-3d text-xs font-medium ${classes[priority]}`}>
      {TASK_PRIORITY_LABELS[priority]}
    </span>
  )
}
