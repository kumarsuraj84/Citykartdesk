import type { ProjectPriority } from '@/types'

export const PROJECT_PRIORITY_STYLES: Record<ProjectPriority, string> = {
  P1: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
  P2: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  P3: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

export function ProjectPriorityBadge({ priority, size = 'md' }: { priority: ProjectPriority; size?: 'sm' | 'md' }) {
  const base =
    size === 'sm'
      ? 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap shrink-0'
      : 'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0'

  return <span className={`${base} ${PROJECT_PRIORITY_STYLES[priority]}`}>{priority}</span>
}
