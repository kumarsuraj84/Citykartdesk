-- Two more RLS scoping gaps found by the broader RBAC audit (same root cause
-- as migration 104: a SELECT policy scoped by org_id alone, with no per-row
-- restriction, while every sibling table in the same module got it right).

-- intake_notes / intake_outbound: every OTHER intake table (intake_messages,
-- intake_channels, intake_threads, intake_classifications, intake_reviews,
-- intake_rules, intake_pipeline_config, intake_attachments, intake_audit_log)
-- requires agent-tier role to read. These two were the odd ones out — a plain
-- 'user' could read every inbound-mailbox reply (to/cc/subject/body) and every
-- agent-internal note across the org via a direct REST call, bypassing the
-- page-level gate entirely (RLS is the real boundary, not page routing).
DROP POLICY IF EXISTS "intake_notes_org_read" ON intake_notes;
CREATE POLICY "intake_notes_org_read" ON intake_notes FOR SELECT USING (
  org_id = current_org_id() AND
  current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
);

DROP POLICY IF EXISTS "intake_outbound_org_read" ON intake_outbound;
CREATE POLICY "intake_outbound_org_read" ON intake_outbound FOR SELECT USING (
  org_id = current_org_id() AND
  current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
);

-- task_dependencies: task_deps_delete and every other task-child table
-- (task_comments, task_activity, task_attachments, task_custom_field_values)
-- join back to `tasks` to check created_by/assignee_id/team membership —
-- task_deps_select never did, so it leaked which tasks exist (via
-- task_id/depends_on_task_id) to anyone in the org regardless of visibility
-- into either task.
DROP POLICY IF EXISTS "task_deps_select" ON task_dependencies;
CREATE POLICY "task_deps_select" ON task_dependencies FOR SELECT USING (
  org_id = current_org_id() AND (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_dependencies.task_id
        AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid() OR (t.task_type = 'team' AND is_team_member(t.team_id)))
    )
    OR EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_dependencies.depends_on_task_id
        AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid() OR (t.task_type = 'team' AND is_team_member(t.team_id)))
    )
    OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
  )
);

NOTIFY pgrst, 'reload schema';
