-- ============================================================
-- RLS hardening — cross-tenant leak fixes (RBAC audit, 2026-08-07)
--
-- Root cause (category A/B below): several migrations that introduced
-- per-org isolation (033, 036, 045, 071) intended to replace the original
-- table policies from 20240101000000_initial_schema.sql, but the DROP
-- statements targeted names that never matched the originals (e.g. dropping
-- "services_select" when the real policy was named "services_read"). Since
-- Postgres OR's multiple PERMISSIVE policies together, the old unscoped
-- policy stayed live underneath the new org-scoped one and silently
-- defeated it. Verified by diffing every CREATE POLICY against every DROP
-- POLICY across all 79 prior migrations — every policy touched below is
-- either provably never dropped, or is the sole (and unscoped) policy for
-- its table.
--
-- Category C fixes replace a single unscoped policy in place (no dangling
-- duplicate — that policy was simply never given an org check to begin
-- with). Category D hardens the task-attachments storage bucket to match
-- request-attachments' stricter, already-correct model.
-- ============================================================

-- ── A. Dangling permissive duplicates — drop the pre-multi-tenancy original;
--       the org-scoped replacement already exists and is unaffected. ────────

DROP POLICY IF EXISTS "profiles_read"             ON profiles;
DROP POLICY IF EXISTS "services_read"              ON services;
DROP POLICY IF EXISTS "services_write"             ON services;
DROP POLICY IF EXISTS "service_categories_read"    ON service_categories;
DROP POLICY IF EXISTS "service_categories_write"   ON service_categories;
DROP POLICY IF EXISTS "departments_read"           ON departments;
DROP POLICY IF EXISTS "departments_write"          ON departments;
DROP POLICY IF EXISTS "approval_workflows_read"    ON approval_workflows;
DROP POLICY IF EXISTS "approval_workflows_write"   ON approval_workflows;
DROP POLICY IF EXISTS "sla_select"                 ON global_sla_config;
DROP POLICY IF EXISTS "sla_write"                  ON global_sla_config;
DROP POLICY IF EXISTS "tmpl_select"                ON task_templates;
DROP POLICY IF EXISTS "tmpl_write"                 ON task_templates;
DROP POLICY IF EXISTS "request_comments_select"    ON request_comments;
DROP POLICY IF EXISTS "team_members_read"          ON team_members;
DROP POLICY IF EXISTS "team_members_write"         ON team_members;

-- ── B. No replacement was ever created for these two tables — drop the
--       unscoped original and add a proper org-scoped policy so the table
--       doesn't go from "leaky" straight to "nobody can read it". ──────────

DROP POLICY IF EXISTS "teams_read"  ON teams;
DROP POLICY IF EXISTS "teams_write" ON teams;

CREATE POLICY "teams_select" ON teams FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "teams_admin" ON teams FOR ALL USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
) WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);

DROP POLICY IF EXISTS "approval_workflow_steps_read"  ON approval_workflow_steps;
DROP POLICY IF EXISTS "approval_workflow_steps_write" ON approval_workflow_steps;

CREATE POLICY "approval_workflow_steps_select" ON approval_workflow_steps FOR SELECT USING (
  EXISTS (SELECT 1 FROM approval_workflows w WHERE w.id = workflow_id AND w.org_id = current_org_id())
);
CREATE POLICY "approval_workflow_steps_admin" ON approval_workflow_steps FOR ALL USING (
  EXISTS (
    SELECT 1 FROM approval_workflows w
    WHERE w.id = workflow_id AND w.org_id = current_org_id()
  )
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM approval_workflows w
    WHERE w.id = workflow_id AND w.org_id = current_org_id()
  )
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);

-- ── C. Sole existing policy for its table, never given an org check ────────

DROP POLICY IF EXISTS "request_activity_select" ON request_activity;
CREATE POLICY "request_activity_select" ON request_activity FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id
      AND r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id = ANY(current_user_team_ids())
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
      )
  )
);

DROP POLICY IF EXISTS "approvals_select" ON approvals;
CREATE POLICY "approvals_select" ON approvals FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id
      AND r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id = ANY(current_user_team_ids())
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
      )
  )
);

DROP POLICY IF EXISTS "approval_decisions_select" ON approval_decisions;
CREATE POLICY "approval_decisions_select" ON approval_decisions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM approvals a
    JOIN requests r ON r.id = a.request_id
    WHERE a.id = approval_id
      AND r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id = ANY(current_user_team_ids())
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
      )
  )
);

DROP POLICY IF EXISTS "csat_select" ON csat_surveys;
CREATE POLICY "csat_select" ON csat_surveys FOR SELECT USING (
  requester_id = auth.uid()
  OR (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'))
);

-- platform_owner is the SaaS operator role and legitimately sees error
-- reports across every tenant; a tenant's own admin must not.
DROP POLICY IF EXISTS "error_reports_select" ON error_reports;
CREATE POLICY "error_reports_select" ON error_reports FOR SELECT USING (
  current_user_role() = 'platform_owner'
  OR (current_user_role() = 'admin' AND org_id = current_org_id())
);

DROP POLICY IF EXISTS "sub_categories_select" ON service_sub_categories;
CREATE POLICY "sub_categories_select" ON service_sub_categories FOR SELECT USING (
  is_active = true
  AND EXISTS (SELECT 1 FROM service_categories c WHERE c.id = category_id AND c.org_id = current_org_id())
);

DROP POLICY IF EXISTS "sub_categories_admin_write" ON service_sub_categories;
CREATE POLICY "sub_categories_admin_write" ON service_sub_categories FOR ALL USING (
  EXISTS (SELECT 1 FROM service_categories c WHERE c.id = category_id AND c.org_id = current_org_id())
  AND current_user_role() IN ('admin', 'platform_owner')
) WITH CHECK (
  EXISTS (SELECT 1 FROM service_categories c WHERE c.id = category_id AND c.org_id = current_org_id())
  AND current_user_role() IN ('admin', 'platform_owner')
);

DROP POLICY IF EXISTS "request_attachments_select" ON request_attachments;
CREATE POLICY "request_attachments_select" ON request_attachments FOR SELECT USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id
      AND r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id = ANY(current_user_team_ids())
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
      )
  )
  AND (
    is_internal = false
    OR (SELECT r2.team_id FROM requests r2 WHERE r2.id = request_id) = ANY(current_user_team_ids())
    OR current_user_role() IN ('manager', 'admin', 'platform_owner')
  )
);

-- request_attachments has no team_id column of its own — team_id is only
-- reachable via the parent request, hence the correlated subquery below
-- (matches the pattern the original policy used).
DROP POLICY IF EXISTS "request_attachments_update" ON request_attachments;
CREATE POLICY "request_attachments_update" ON request_attachments FOR UPDATE USING (
  uploaded_by = auth.uid()
  OR (
    EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.org_id = current_org_id())
    AND (
      (SELECT r2.team_id FROM requests r2 WHERE r2.id = request_id) = ANY(current_user_team_ids())
      OR current_user_role() IN ('manager', 'admin', 'platform_owner')
    )
  )
) WITH CHECK (
  uploaded_by = auth.uid()
  OR (
    EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.org_id = current_org_id())
    AND (
      (SELECT r2.team_id FROM requests r2 WHERE r2.id = request_id) = ANY(current_user_team_ids())
      OR current_user_role() IN ('manager', 'admin', 'platform_owner')
    )
  )
);

DROP POLICY IF EXISTS "task_attachments_select" ON task_attachments;
CREATE POLICY "task_attachments_select" ON task_attachments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_id
      AND t.org_id = current_org_id()
      AND (
        t.created_by = auth.uid()
        OR t.assignee_id = auth.uid()
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
        OR (t.team_id IS NOT NULL AND t.team_id = ANY(current_user_team_ids()))
      )
  )
);

DROP POLICY IF EXISTS "task_attachments_insert" ON task_attachments;
CREATE POLICY "task_attachments_insert" ON task_attachments FOR INSERT WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_id
      AND t.org_id = current_org_id()
      AND (
        t.created_by = auth.uid()
        OR t.assignee_id = auth.uid()
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
        OR (t.team_id IS NOT NULL AND t.team_id = ANY(current_user_team_ids()))
      )
  )
);

DROP POLICY IF EXISTS "task_attachments_delete" ON task_attachments;
CREATE POLICY "task_attachments_delete" ON task_attachments FOR DELETE USING (
  uploaded_by = auth.uid()
  OR (
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.org_id = current_org_id())
    AND current_user_role() IN ('manager', 'admin', 'platform_owner')
  )
);

DROP POLICY IF EXISTS "custom_fields_select" ON task_custom_fields;
CREATE POLICY "custom_fields_select" ON task_custom_fields FOR SELECT USING (
  EXISTS (SELECT 1 FROM teams tm WHERE tm.id = team_id AND tm.org_id = current_org_id())
  AND (team_id = ANY(current_user_team_ids()) OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);
DROP POLICY IF EXISTS "custom_fields_insert" ON task_custom_fields;
CREATE POLICY "custom_fields_insert" ON task_custom_fields FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM teams tm WHERE tm.id = team_id AND tm.org_id = current_org_id())
  AND (team_id = ANY(current_user_team_ids()) OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);
DROP POLICY IF EXISTS "custom_fields_update" ON task_custom_fields;
CREATE POLICY "custom_fields_update" ON task_custom_fields FOR UPDATE USING (
  EXISTS (SELECT 1 FROM teams tm WHERE tm.id = team_id AND tm.org_id = current_org_id())
  AND (created_by = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);
DROP POLICY IF EXISTS "custom_fields_delete" ON task_custom_fields;
CREATE POLICY "custom_fields_delete" ON task_custom_fields FOR DELETE USING (
  EXISTS (SELECT 1 FROM teams tm WHERE tm.id = team_id AND tm.org_id = current_org_id())
  AND (created_by = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);

DROP POLICY IF EXISTS "custom_field_values_select" ON task_custom_field_values;
CREATE POLICY "custom_field_values_select" ON task_custom_field_values FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND t.org_id = current_org_id()
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  )
);
DROP POLICY IF EXISTS "custom_field_values_upsert" ON task_custom_field_values;
CREATE POLICY "custom_field_values_upsert" ON task_custom_field_values FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND t.org_id = current_org_id()
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  )
);
DROP POLICY IF EXISTS "custom_field_values_update" ON task_custom_field_values;
CREATE POLICY "custom_field_values_update" ON task_custom_field_values FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND t.org_id = current_org_id()
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  )
);
DROP POLICY IF EXISTS "custom_field_values_delete" ON task_custom_field_values;
CREATE POLICY "custom_field_values_delete" ON task_custom_field_values FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND t.org_id = current_org_id()
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  )
);

DROP POLICY IF EXISTS "tmpl_item_select" ON task_template_items;
CREATE POLICY "tmpl_item_select" ON task_template_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = template_id AND tt.org_id = current_org_id())
);
DROP POLICY IF EXISTS "tmpl_item_write" ON task_template_items;
CREATE POLICY "tmpl_item_write" ON task_template_items FOR ALL USING (
  EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = template_id AND tt.org_id = current_org_id())
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
) WITH CHECK (
  EXISTS (SELECT 1 FROM task_templates tt WHERE tt.id = template_id AND tt.org_id = current_org_id())
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);

DROP POLICY IF EXISTS "esc_events_admin" ON sla_escalation_events;
CREATE POLICY "esc_events_admin" ON sla_escalation_events FOR ALL USING (
  EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.org_id = current_org_id())
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
) WITH CHECK (
  EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.org_id = current_org_id())
  AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);

DROP POLICY IF EXISTS "time_entries_select" ON request_time_entries;
CREATE POLICY "time_entries_select" ON request_time_entries FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_time_entries.request_id
      AND r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id = ANY(current_user_team_ids())
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
      )
  )
);
DROP POLICY IF EXISTS "time_entries_insert" ON request_time_entries;
CREATE POLICY "time_entries_insert" ON request_time_entries FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_time_entries.request_id
      AND r.org_id = current_org_id()
      AND (r.team_id = ANY(current_user_team_ids()) OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  )
);
DROP POLICY IF EXISTS "time_entries_delete" ON request_time_entries;
CREATE POLICY "time_entries_delete" ON request_time_entries FOR DELETE USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_time_entries.request_id
      AND r.org_id = current_org_id()
      AND current_user_role() IN ('manager', 'admin', 'platform_owner')
  )
);

-- tasks_update: the sole UPDATE policy for `tasks` was never given an org
-- check (migration 033/045 fixed tasks_select/tasks_insert but not
-- tasks_update), and unlike requests_update it has no WITH CHECK at all, so
-- an authorized updater could silently move a task to a different team/org.
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE USING (
  org_id = current_org_id()
  AND (
    created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR (task_type = 'team' AND team_id = ANY(current_user_team_ids()))
    OR current_user_role() IN ('manager', 'admin', 'platform_owner')
  )
) WITH CHECK (
  org_id = (SELECT t.org_id FROM tasks t WHERE t.id = tasks.id)
  AND (
    created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR (task_type = 'team' AND team_id = ANY(current_user_team_ids()))
    OR current_user_role() IN ('manager', 'admin', 'platform_owner')
  )
);

-- requests_update: USING/WITH CHECK checked team membership + immutable
-- fields but never org_id — a manager/admin from any org could update any
-- other org's request. Restores the same org_id = current_org_id() guard
-- requests_select/requests_insert already have, and adds org_id to the
-- immutable-fields list (requester_id/service_id/team_id were already
-- locked; org_id was not).
DROP POLICY IF EXISTS "requests_update" ON requests;
CREATE POLICY "requests_update" ON requests FOR UPDATE USING (
  org_id = current_org_id()
  AND (
    team_id = ANY(current_user_team_ids())
    OR current_user_role() IN ('manager', 'admin', 'platform_owner')
  )
) WITH CHECK (
  org_id = (SELECT r.org_id FROM requests r WHERE r.id = requests.id)
  AND (team_id = ANY(current_user_team_ids()) OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  AND requester_id = (SELECT r.requester_id FROM requests r WHERE r.id = requests.id)
  AND service_id   = (SELECT r.service_id   FROM requests r WHERE r.id = requests.id)
  AND team_id      = (SELECT r.team_id      FROM requests r WHERE r.id = requests.id)
);

-- ── D. task-attachments storage bucket — bring up to request-attachments'
--       already-correct standard (task/org-visibility check on read, owner
--       check on delete; insert stays auth-only, fine-grained check lives
--       in the server action, matching request-attachments' own posture). ──

DROP POLICY IF EXISTS "task_attach_storage_select" ON storage.objects;
CREATE POLICY "task_attach_storage_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'task-attachments'
    AND EXISTS (
      SELECT 1 FROM task_attachments ta
      JOIN tasks t ON t.id = ta.task_id
      WHERE ta.storage_path = name
        AND t.org_id = current_org_id()
        AND (
          t.created_by = auth.uid()
          OR t.assignee_id = auth.uid()
          OR current_user_role() IN ('manager', 'admin', 'platform_owner')
          OR (t.team_id IS NOT NULL AND t.team_id = ANY(current_user_team_ids()))
        )
    )
  );

DROP POLICY IF EXISTS "task_attach_storage_insert" ON storage.objects;
CREATE POLICY "task_attach_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'task-attachments' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "task_attach_storage_delete" ON storage.objects;
CREATE POLICY "task_attach_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'task-attachments' AND (owner)::uuid = auth.uid());
