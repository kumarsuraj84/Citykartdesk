import type { TaskPriority } from '@/types'

/**
 * DESK-UI-003 — canonical task-priority display label, shared by every
 * component that renders one. Before this, four components each hardcoded
 * their own label map for the same three-value enum
 * (components/tasks/TaskBadges.tsx, TaskTable.tsx, TaskDetailInline.tsx all
 * said "Medium"; TaskDetailPanel.tsx alone said "Normal") — the same task's
 * priority read differently depending on which screen you were looking at
 * it from. This is the one source of truth; component-specific styling
 * (colors, dots, flag icon classes) stays local to each component since
 * only the label text was reported/confirmed inconsistent.
 */
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}
