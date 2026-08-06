-- Performance indexes for missing query patterns

-- Tasks: manager "team overdue" view filters on (team_id, due_date)
CREATE INDEX IF NOT EXISTS idx_tasks_team_due ON tasks(team_id, due_date ASC)
  WHERE status NOT IN ('done','cancelled');

-- Notifications: unarchived filter (most common query path)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unarchived
  ON notifications(user_id, created_at DESC)
  WHERE archived_at IS NULL;

-- Requests: created_at for list pagination
CREATE INDEX IF NOT EXISTS idx_requests_org_created
  ON requests(org_id, created_at DESC);

-- Tasks: subtask count lookup
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)
  WHERE parent_task_id IS NOT NULL;
