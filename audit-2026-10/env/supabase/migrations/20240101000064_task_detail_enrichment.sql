-- ════════════════════════════════════════════════════════════════════════════
--  Task detail enrichment: tags, date range, multi-assignee
--  Adds the fields the redesigned task-detail view needs. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tags + start date on tasks ──────────────────────────────────────────────
-- tags as a plain text[] (simple, no extra table); start_date pairs with the
-- existing due_date to form a start → due range.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags       TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;

-- ── Multi-assignee join table ───────────────────────────────────────────────
-- A task keeps its single assignee_id (the "primary" assignee, used by the
-- untouched task list). task_assignees holds the FULL set shown on the detail
-- view. Existing assignee_id values are backfilled below so nothing is lost.
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id    UUID        NOT NULL REFERENCES tasks(id)    ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);

-- Backfill: seed the join table from each task's current assignee_id.
INSERT INTO task_assignees (task_id, user_id)
SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL
ON CONFLICT (task_id, user_id) DO NOTHING;

ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;

-- Select / insert / delete mirror the task_comments visibility rule: you can
-- manage assignees on any task you can see (creator, an assignee, or a member
-- of the owning team).
DROP POLICY IF EXISTS "task_assignees_select" ON task_assignees;
CREATE POLICY "task_assignees_select" ON task_assignees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id
        AND (
          t.created_by = auth.uid()
          OR t.assignee_id = auth.uid()
          OR (t.task_type = 'team' AND is_team_member(t.team_id))
        )
    )
  );

DROP POLICY IF EXISTS "task_assignees_insert" ON task_assignees;
CREATE POLICY "task_assignees_insert" ON task_assignees
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id
        AND (
          t.created_by = auth.uid()
          OR t.assignee_id = auth.uid()
          OR (t.task_type = 'team' AND is_team_member(t.team_id))
        )
    )
  );

DROP POLICY IF EXISTS "task_assignees_delete" ON task_assignees;
CREATE POLICY "task_assignees_delete" ON task_assignees
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id
        AND (
          t.created_by = auth.uid()
          OR t.assignee_id = auth.uid()
          OR (t.task_type = 'team' AND is_team_member(t.team_id))
        )
    )
  );

GRANT ALL ON TABLE task_assignees TO anon, authenticated, service_role;
