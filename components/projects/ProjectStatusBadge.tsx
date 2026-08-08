import type { ProjectStatus } from '@/types'

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked:     'Blocked',
  done:        'Done',
  cancelled:   'Cancelled',
}

export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  not_started: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  blocked:     'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  done:        'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
}

interface ProjectStatusBadgeProps {
  status: ProjectStatus
  size?: 'sm' | 'md'
}

export function ProjectStatusBadge({ status, size = 'md' }: ProjectStatusBadgeProps) {
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0'

  return (
    <span className={`${base} ${PROJECT_STATUS_STYLES[status]}`}>
      <span className="h-1.5 w-1.5 rounded bg-current opacity-70" />
      {PROJECT_STATUS_LABELS[status]}
    </span>
  )
}
