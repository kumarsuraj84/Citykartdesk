/**
 * Canonical status-group taxonomy — every request/task status, however an
 * admin has relabeled it, rolls up into one of five fixed groups. Shared by
 * project progress rollups and milestone burndown so both read from the same
 * mapping instead of duplicating it per query.
 *
 * Note: `task_status`/`request_status` are fixed Postgres enums, not rows in
 * an admin-editable table — `task_statuses`/`task_priorities` are a separate,
 * currently-unwired display-config table (its `value` column doesn't match
 * the real `task_status` enum values), so there's no DB column to retrofit
 * here. This constant is the single source of truth until that changes.
 */
import type { ProjectProgress, TaskStatus, RequestStatus } from '@/types'

export const TASK_STATUS_GROUP: Record<TaskStatus, keyof ProjectProgress> = {
  open:        'not_started',
  in_progress: 'in_progress',
  done:        'done',
  cancelled:   'cancelled',
}

export const REQUEST_STATUS_GROUP: Record<RequestStatus, keyof ProjectProgress> = {
  pending_approval: 'in_progress',
  open:             'not_started',
  assigned:         'in_progress',
  in_progress:      'in_progress',
  waiting_user:     'in_progress',
  resolved:         'done',
  closed:           'done',
  cancelled:        'cancelled',
}
