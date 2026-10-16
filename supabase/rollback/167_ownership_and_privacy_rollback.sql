-- Rollback of 20240101000167_ownership_and_privacy.sql (restores the previous policies and privileges).
BEGIN;
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
CREATE POLICY project_members_insert ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS project_members_delete ON public.project_members;
CREATE POLICY project_members_delete ON public.project_members FOR DELETE TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS milestones_insert ON public.milestones;
CREATE POLICY milestones_insert ON public.milestones FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS milestones_update ON public.milestones;
CREATE POLICY milestones_update ON public.milestones FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS project_updates_insert ON public.project_updates;
CREATE POLICY project_updates_insert ON public.project_updates FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]) AND author_id = auth.uid());
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated WITH CHECK (org_id = public.current_org_id() AND created_by = auth.uid());
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND (created_by = auth.uid() OR assignee_id = auth.uid() OR (task_type = 'team'::task_type AND team_id = ANY (public.current_user_team_ids())) OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))
  WITH CHECK (org_id = (SELECT t.org_id FROM public.tasks t WHERE t.id = tasks.id) AND (created_by = auth.uid() OR assignee_id = auth.uid() OR (task_type = 'team'::task_type AND team_id = ANY (public.current_user_team_ids())) OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])));
GRANT INSERT, UPDATE, DELETE ON public.task_attachments TO authenticated;
CREATE POLICY task_attach_storage_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'task-attachments' AND owner = auth.uid());
DROP POLICY IF EXISTS request_comments_insert ON public.request_comments;
CREATE POLICY request_comments_insert ON public.request_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND EXISTS (SELECT 1 FROM public.requests r WHERE r.id = request_comments.request_id AND (r.requester_id = auth.uid() OR public.is_team_member(r.team_id) OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]) OR public.is_request_collaborator(r.id))));
DROP POLICY IF EXISTS request_attachments_insert ON public.request_attachments;
CREATE POLICY request_attachments_insert ON public.request_attachments FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.requests r WHERE r.id = request_attachments.request_id AND (r.requester_id = auth.uid() OR public.is_team_member(r.team_id) OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]) OR public.is_request_collaborator(r.id))));
GRANT UPDATE, DELETE ON public.request_attachments TO authenticated;
DROP POLICY IF EXISTS csat_update_requester ON public.csat_surveys;
CREATE POLICY csat_update_requester ON public.csat_surveys FOR UPDATE TO authenticated USING (requester_id = auth.uid() AND submitted_at IS NULL);
DROP POLICY IF EXISTS time_entries_update ON public.request_time_entries;
CREATE POLICY time_entries_update ON public.request_time_entries FOR UPDATE TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS alert_rules_select ON public.alert_rules;
CREATE POLICY alert_rules_select ON public.alert_rules FOR SELECT TO authenticated USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS escalation_policies_select ON public.escalation_policies;
CREATE POLICY escalation_policies_select ON public.escalation_policies FOR SELECT TO authenticated USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS perm_overrides_select ON public.permission_overrides;
CREATE POLICY perm_overrides_select ON public.permission_overrides FOR SELECT TO authenticated USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS scheduled_reports_select ON public.scheduled_reports;
CREATE POLICY scheduled_reports_select ON public.scheduled_reports FOR SELECT TO authenticated USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS related_select ON public.related_requests;
CREATE POLICY related_select ON public.related_requests FOR SELECT TO authenticated USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members FOR SELECT TO authenticated USING (org_id = public.current_org_id());
COMMIT;
