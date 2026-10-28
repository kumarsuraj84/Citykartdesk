-- ============================================================
-- Stabilization: task_comments internal comment visibility
-- is_internal = true comments must only be readable by agents
-- (team members) or managers/admins. Regular users who created
-- a personal task can see the task but NOT its internal notes.
-- ============================================================

-- Drop the permissive select policy and replace with one that
-- gates is_internal behind agent/manager/admin status.
DROP POLICY IF EXISTS "task_comments_select" ON task_comments;

CREATE POLICY "task_comments_select" ON task_comments
  FOR SELECT TO authenticated
  USING (
    -- Must be a participant on the parent task
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id
        AND (
          t.created_by  = auth.uid()
          OR t.assignee_id = auth.uid()
          OR (t.task_type = 'team' AND is_team_member(t.team_id))
        )
    )
    -- Internal comments are restricted to agents and managers/admins
    AND (
      is_internal = false
      OR is_agent()
      OR current_user_role() IN ('manager', 'admin')
    )
  );
