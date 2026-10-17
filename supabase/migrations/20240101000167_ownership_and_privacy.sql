-- Remediation phase 2 (LOCAL). Rollback: supabase/rollback/167_ownership_and_privacy_rollback.sql
--  VAPT-018  projects, tasks, task files: the database now checks WHICH project / task / file a person touches, not only that they are staff
--  VAPT-021  comments and attachment rows can only be added to tickets of the person's own organisation; attachment rows can no longer be edited or deleted directly
--  VAPT-019  internal configuration (alert rules, escalation rules, permission overrides, scheduled reports, related-ticket links, who is in which group) is not
--            readable by ordinary employees
--  VAPT-010-class  CSAT and time-entry rows cannot be re-pointed at another ticket

BEGIN;

-- The privileges of anon and authenticated on the objects this migration touches are written down first, so the rollback restores EXACTLY what was there
-- (production's grants may differ from a database built from the migrations; nothing is guessed). The table is locked and removed by the last rollback.
CREATE TABLE IF NOT EXISTS public._grant_snapshots (
  stage text NOT NULL, kind text NOT NULL, grantee text NOT NULL, object_name text NOT NULL, privilege text NOT NULL,
  PRIMARY KEY (stage, kind, grantee, object_name, privilege)
);
ALTER TABLE public._grant_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._grant_snapshots FROM PUBLIC, anon, authenticated;

-- a marker row for every object present now ('-'), so the rollback touches only these
INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege)
SELECT '167', CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'table' END, 'anon', c.relname, '-'
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S') AND c.relname IN ('task_attachments', 'request_attachments')
ON CONFLICT DO NOTHING;
INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege)
SELECT '167', CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'table' END, r.rolname, c.relname, a.privilege_type
FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S') AND r.rolname IN ('anon', 'authenticated') AND c.relname IN ('task_attachments', 'request_attachments')
ON CONFLICT DO NOTHING;
-- column-level privileges (for example UPDATE on single columns of profiles)
INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege)
SELECT '167', 'column', r.rolname, c.relname || '.' || t.attname, a.privilege_type
FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid AND t.attnum > 0 AND NOT t.attisdropped CROSS JOIN LATERAL aclexplode(t.attacl) a JOIN pg_roles r ON r.oid = a.grantee
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND r.rolname IN ('anon', 'authenticated') AND c.relname IN ('task_attachments', 'request_attachments')
ON CONFLICT DO NOTHING;


-- ── projects: the same test the application already makes (can_view_project), now in the database ─────────────────────────────────────────
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
CREATE POLICY project_members_insert ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    AND public.can_view_project(project_id)
  );
DROP POLICY IF EXISTS project_members_delete ON public.project_members;
CREATE POLICY project_members_delete ON public.project_members FOR DELETE TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    AND public.can_view_project(project_id)
  );
DROP POLICY IF EXISTS milestones_insert ON public.milestones;
CREATE POLICY milestones_insert ON public.milestones FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    AND public.can_view_project(project_id)
  );
DROP POLICY IF EXISTS milestones_update ON public.milestones;
CREATE POLICY milestones_update ON public.milestones FOR UPDATE TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    AND public.can_view_project(project_id)
  )
  WITH CHECK (org_id = public.current_org_id() AND public.can_view_project(project_id));
DROP POLICY IF EXISTS project_updates_insert ON public.project_updates;
CREATE POLICY project_updates_insert ON public.project_updates FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    AND author_id = auth.uid()
    AND public.can_view_project(project_id)
  );

-- ── tasks: staff only, and every person / group / ticket / project / parent a task points at must be one the creator is allowed to use ──────
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND created_by = auth.uid()
    AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    AND (assignee_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = tasks.assignee_id AND p.org_id = public.current_org_id()))
    AND (team_id IS NULL OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tasks.team_id AND t.org_id = public.current_org_id()))
    AND (request_id IS NULL OR EXISTS (SELECT 1 FROM public.requests r WHERE r.id = tasks.request_id))
    AND (parent_task_id IS NULL OR EXISTS (SELECT 1 FROM public.tasks pt WHERE pt.id = tasks.parent_task_id))
    AND (project_id IS NULL OR public.can_view_project(project_id))
  );
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR assignee_id = auth.uid() OR (task_type = 'team'::task_type AND team_id = ANY (public.current_user_team_ids()))
         OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
  )
  WITH CHECK (
    org_id = (SELECT t.org_id FROM public.tasks t WHERE t.id = tasks.id)
    AND (created_by = auth.uid() OR assignee_id = auth.uid() OR (task_type = 'team'::task_type AND team_id = ANY (public.current_user_team_ids()))
         OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
    AND (assignee_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = tasks.assignee_id AND p.org_id = public.current_org_id()))
    AND (team_id IS NULL OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tasks.team_id AND t.org_id = public.current_org_id()))
    AND (request_id IS NULL OR EXISTS (SELECT 1 FROM public.requests r WHERE r.id = tasks.request_id))
    AND (project_id IS NULL OR public.can_view_project(project_id))
  );

-- ── task files: written only by the server (it checks the file and the task); nobody forges a file record or uploads / deletes directly ───────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.task_attachments FROM authenticated, anon;
DROP POLICY IF EXISTS task_attach_storage_delete ON storage.objects;

-- ── tickets' comments and attachment rows: only tickets of the person's own organisation ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS request_comments_insert ON public.request_comments;
CREATE POLICY request_comments_insert ON public.request_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.requests r
       WHERE r.id = request_comments.request_id AND r.org_id = public.current_org_id()
         AND (r.requester_id = auth.uid() OR public.is_team_member(r.team_id)
              OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
              OR public.is_request_collaborator(r.id))
    )
  );
DROP POLICY IF EXISTS request_attachments_insert ON public.request_attachments;
CREATE POLICY request_attachments_insert ON public.request_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.requests r
       WHERE r.id = request_attachments.request_id AND r.org_id = public.current_org_id()
         AND (r.requester_id = auth.uid() OR public.is_team_member(r.team_id)
              OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
              OR public.is_request_collaborator(r.id))
    )
  );
-- a file row can be added directly, but never changed or deleted (the server does that, after its own check): an uploader could restore a deleted file
REVOKE UPDATE, DELETE, TRUNCATE ON public.request_attachments FROM authenticated, anon;

-- ── a survey answer or a time entry cannot be re-pointed at another ticket ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS csat_update_requester ON public.csat_surveys;
CREATE POLICY csat_update_requester ON public.csat_surveys FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() AND submitted_at IS NULL)
  WITH CHECK (requester_id = auth.uid() AND request_id = (SELECT c.request_id FROM public.csat_surveys c WHERE c.id = csat_surveys.id));
DROP POLICY IF EXISTS time_entries_update ON public.request_time_entries;
CREATE POLICY time_entries_update ON public.request_time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND request_id = (SELECT e.request_id FROM public.request_time_entries e WHERE e.id = request_time_entries.id));

-- ── internal configuration is not for ordinary employees ──────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS alert_rules_select ON public.alert_rules;
CREATE POLICY alert_rules_select ON public.alert_rules FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.current_user_role() <> 'user');
DROP POLICY IF EXISTS escalation_policies_select ON public.escalation_policies;
CREATE POLICY escalation_policies_select ON public.escalation_policies FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.current_user_role() <> 'user');
DROP POLICY IF EXISTS perm_overrides_select ON public.permission_overrides;
CREATE POLICY perm_overrides_select ON public.permission_overrides FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.current_user_role() <> 'user');
DROP POLICY IF EXISTS scheduled_reports_select ON public.scheduled_reports;
CREATE POLICY scheduled_reports_select ON public.scheduled_reports FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.current_user_role() <> 'user');
DROP POLICY IF EXISTS related_select ON public.related_requests;
CREATE POLICY related_select ON public.related_requests FOR SELECT TO authenticated USING (org_id = public.current_org_id() AND public.current_user_role() <> 'user');
DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND (user_id = auth.uid() OR public.current_user_role() <> 'user'));

COMMIT;
