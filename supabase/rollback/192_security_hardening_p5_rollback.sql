-- Rollback of 192 (run it only after the app of this release has been rolled back).
-- Puts back: managers may write the four configuration tables through the data API again; error_reports accepts any signed-in insert; csat_surveys has table-wide UPDATE;
-- the old system_log_archive_old without the floor. Indexes dropped as duplicates are re-created (plain). The two helper functions are removed. Storage bucket types
-- and the grants on the three server-only tables are NOT put back (re-opening them would only re-open the weakness).
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.form_field_library') IS NOT NULL THEN
    DROP POLICY IF EXISTS "form_field_library_admin" ON public.form_field_library;
    CREATE POLICY "form_field_library_admin" ON public.form_field_library FOR ALL
      USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])))
      WITH CHECK ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])));
  END IF;
  IF to_regclass('public.service_location_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS "service_location_tags_admin" ON public.service_location_tags;
    CREATE POLICY "service_location_tags_admin" ON public.service_location_tags FOR ALL
      USING (EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_location_tags.service_id AND s.org_id = current_org_id()
                     AND current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])));
  END IF;
  IF to_regclass('public.service_sub_category_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS "service_sub_category_tags_admin" ON public.service_sub_category_tags;
    CREATE POLICY "service_sub_category_tags_admin" ON public.service_sub_category_tags FOR ALL
      USING (EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_sub_category_tags.service_id AND s.org_id = current_org_id()
                     AND current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])));
  END IF;
  IF to_regclass('public.sla_escalation_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "esc_events_admin" ON public.sla_escalation_events;
    CREATE POLICY "esc_events_admin" ON public.sla_escalation_events FOR ALL
      USING ((EXISTS (SELECT 1 FROM public.requests r WHERE r.id = sla_escalation_events.request_id AND r.org_id = current_org_id()))
             AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])))
      WITH CHECK ((EXISTS (SELECT 1 FROM public.requests r WHERE r.id = sla_escalation_events.request_id AND r.org_id = current_org_id()))
             AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])));
  END IF;
  IF to_regclass('public.error_reports') IS NOT NULL THEN
    DROP POLICY IF EXISTS "error_reports_insert" ON public.error_reports;
    CREATE POLICY "error_reports_insert" ON public.error_reports FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
    ALTER TABLE public.error_reports DROP CONSTRAINT IF EXISTS error_reports_length_chk;
  END IF;
  IF to_regclass('public.csat_surveys') IS NOT NULL THEN
    GRANT UPDATE ON TABLE public.csat_surveys TO authenticated;
  END IF;
END $$;

-- indexes dropped as exact duplicates (the surviving unique / newer index does the same job)
CREATE INDEX IF NOT EXISTS idx_requests_created ON public.requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_intake_message ON public.requests (intake_message_id) WHERE intake_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_csat_request ON public.csat_surveys (request_id);
CREATE INDEX IF NOT EXISTS idx_service_sub_category_tags_sub_category ON public.service_sub_category_tags (sub_category_id);
-- the foreign key indexes that were added
DROP INDEX IF EXISTS public.idx_csat_surveys_requester_id;
DROP INDEX IF EXISTS public.idx_approval_email_codes_approver_id;
DROP INDEX IF EXISTS public.idx_approval_workflow_steps_approver_user_id;
DROP INDEX IF EXISTS public.idx_approvals_requested_by;
DROP INDEX IF EXISTS public.idx_intake_audit_log_actor_id;
DROP INDEX IF EXISTS public.idx_program_rows_org_id;
DROP INDEX IF EXISTS public.idx_program_issues_org_id;

-- the archive function as migration 160 wrote it (no floor)
CREATE OR REPLACE FUNCTION public.system_log_archive_old(p_error_days integer DEFAULT 180, p_audit_years integer DEFAULT 7)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_n bigint;
BEGIN
  PERFORM set_config('citykart.system_log_archive', 'on', true);
  WITH moved AS (
    DELETE FROM public.system_log
    WHERE (category IN ('error', 'event') AND created_at < now() - make_interval(days => p_error_days))
       OR (category IN ('audit', 'security') AND created_at < now() - make_interval(years => p_audit_years))
    RETURNING *
  )
  INSERT INTO public.system_log_archive SELECT * FROM moved;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('citykart.system_log_archive', 'off', true);
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.system_log_archive_old(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_log_archive_old(integer, integer) TO service_role;

DROP FUNCTION IF EXISTS public.revoke_user_sessions(uuid);
DROP FUNCTION IF EXISTS public.quota_add(text, integer, integer, integer);

DELETE FROM auth.schema_migrations WHERE version = '20240101000192';
COMMIT;
NOTIFY pgrst, 'reload schema';
