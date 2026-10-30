BEGIN;
-- ROLLBACK for migration 157 (post-audit High database fixes). Restores the previous policies, grants and helper functions exactly as the
-- audit found them. Using it re-opens the audited weaknesses (D-004, D-006, D-008, D-010, D-014, D-015, D-054): it exists only so the change can
-- be undone if it ever causes a problem. LOCAL, prepared for review; NOT run on production.

DROP TRIGGER IF EXISTS trg_guard_attachment_client_write ON public.request_attachments;
DROP FUNCTION IF EXISTS public.guard_attachment_client_write();
DROP TRIGGER IF EXISTS trg_guard_request_client_write ON public.requests;
DROP FUNCTION IF EXISTS public.guard_request_client_write();

CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT org_id FROM profiles WHERE id = auth.uid() $function$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT role FROM public.profiles WHERE id = auth.uid() $function$;

DROP POLICY IF EXISTS "comments_select" ON public.request_comments;
CREATE POLICY "comments_select" ON public.request_comments FOR SELECT
  USING (
    (
      (EXISTS (SELECT 1 FROM requests r WHERE r.id = request_comments.request_id AND r.org_id = current_org_id()
         AND (r.requester_id = auth.uid() OR r.team_id = ANY (current_user_team_ids())
              OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
              OR r.requester_id = ANY (current_user_subordinate_ids()) OR r.assigned_to = ANY (current_user_subordinate_ids()))))
      OR is_request_approver(request_id)
    )
    AND (NOT is_internal OR is_agent() OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
  );

DROP POLICY IF EXISTS "collab_delete" ON public.request_collaborators;
CREATE POLICY "collab_delete" ON public.request_collaborators FOR DELETE
  USING (added_by = auth.uid() OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]));

DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])));

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('business_hours', 'biz_hours_all', 'biz_hours_select'),
      ('holidays', 'holidays_all', 'holidays_select'),
      ('sla_escalation_rules', 'sla_rules_all', 'sla_rules_select'),
      ('task_statuses', 'ts_admin', 'ts_select'),
      ('task_priorities', 'tp_admin', 'tp_select'),
      ('request_priorities', 'rp_admin', 'rp_select')
    ) AS t(tbl, write_policy, read_policy)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.write_policy, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.read_policy, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', r.read_policy, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (current_user_role() = ANY (ARRAY[''admin''::user_role, ''manager''::user_role, ''platform_owner''::user_role]))', r.write_policy, r.tbl);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "retention_admin" ON public.retention_policies;
DROP POLICY IF EXISTS "retention_select" ON public.retention_policies;
CREATE POLICY "retention_select" ON public.retention_policies FOR SELECT USING (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]));
CREATE POLICY "retention_admin" ON public.retention_policies FOR ALL USING (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS "app_settings_write" ON public.app_settings;
CREATE POLICY "app_settings_write" ON public.app_settings FOR ALL TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))
  WITH CHECK (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]));
GRANT ALL ON public.business_hours, public.holidays, public.sla_escalation_rules, public.task_statuses, public.task_priorities,
             public.request_priorities, public.retention_policies, public.app_settings TO anon;

CREATE POLICY "Authenticated download only" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'request-attachments');
CREATE POLICY "storage_request_attachments_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'request-attachments' AND auth.uid() IS NOT NULL);
DELETE FROM auth.schema_migrations WHERE version = '20240101000157';
COMMIT;
