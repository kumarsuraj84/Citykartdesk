-- ============================================================
-- Phase 4C: Task Foundation
-- task_comments, task_activity, task_activity_action enum
-- RLS policies for tasks (verified + completed)
-- ============================================================

-- ── Task activity action enum ─────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE task_activity_action AS ENUM (
    'created',
    'assigned',
    'unassigned',
    'status_changed',
    'comment_added',
    'completed',
    'reopened',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── task_comments ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL,
  is_internal BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_author ON task_comments(author_id);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- Select: can see comments on tasks you can see
CREATE POLICY "task_comments_select" ON task_comments
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

-- Insert: can comment on tasks you can see
CREATE POLICY "task_comments_insert" ON task_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id
        AND (
          t.created_by = auth.uid()
          OR t.assignee_id = auth.uid()
          OR (t.task_type = 'team' AND is_team_member(t.team_id))
        )
    )
  );

-- Update: only author can edit their own comments
CREATE POLICY "task_comments_update" ON task_comments
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

GRANT ALL ON TABLE task_comments TO anon, authenticated, service_role;

-- ── task_activity ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_activity (
  id         UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID                  NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   UUID                  REFERENCES profiles(id) ON DELETE SET NULL,
  action     task_activity_action  NOT NULL,
  metadata   JSONB                 NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_actor ON task_activity(actor_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_created ON task_activity(created_at);

ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;

-- Select: mirrors tasks_select
CREATE POLICY "task_activity_select" ON task_activity
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

-- Insert: any authenticated user who can see the task
CREATE POLICY "task_activity_insert" ON task_activity
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id
        AND (
          t.created_by = auth.uid()
          OR t.assignee_id = auth.uid()
          OR (t.task_type = 'team' AND is_team_member(t.team_id))
        )
    )
  );

GRANT ALL ON TABLE task_activity TO anon, authenticated, service_role;
