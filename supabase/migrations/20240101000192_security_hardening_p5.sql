-- 192: database side of the post-audit security fixes (P5). LOCAL ONLY until released. Safe to run twice; written so that it cannot fail on existing live data
-- (every object is looked up first, every statement is IF EXISTS / IF NOT EXISTS / DROP-then-CREATE, nothing here adds a unique index or a validated constraint).
-- Rollback: supabase/rollback/192_security_hardening_p5_rollback.sql
--
--   D-01  four configuration tables could still be written through the data API by a "manager": administrators / platform owners only (the server writes with the service key)
--   D-09  three server-only tables: no rights for anyone but the service role
--   D-15  error_reports: a signed-in person may only report as themselves, for their own organisation
--   A-17  csat_surveys: signed-in users may change only rating, comment and submitted_at (not org_id, request_id, requester_id ...)
--   D-18  exact duplicate indexes removed (only after checking the two are the same index, one of them unique or newer)
--   D-19  indexes for foreign keys that had none
--   D-21  storage buckets: file types the application refuses are no longer accepted by the bucket either
--   D-27  system_log_archive_old refuses silly values (less than 30 days / 1 year would archive the whole log)
--   A-05  revoke_user_sessions(): ends all sessions of one person (used after an administrator's password or e-mail change)
--   A-07  quota_add(): a counter that adds an amount (used for the per-person daily upload budget in kilobytes)
BEGIN;

-- ── D-01 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.form_field_library') IS NOT NULL THEN
    DROP POLICY IF EXISTS "form_field_library_admin" ON public.form_field_library;
    CREATE POLICY "form_field_library_admin" ON public.form_field_library FOR ALL
      USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])))
      WITH CHECK ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])));
  END IF;
  IF to_regclass('public.service_location_tags') IS NOT NULL AND to_regclass('public.services') IS NOT NULL THEN
    DROP POLICY IF EXISTS "service_location_tags_admin" ON public.service_location_tags;
    CREATE POLICY "service_location_tags_admin" ON public.service_location_tags FOR ALL
      USING (EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_location_tags.service_id AND s.org_id = current_org_id()
                     AND current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])));
  END IF;
  IF to_regclass('public.service_sub_category_tags') IS NOT NULL AND to_regclass('public.services') IS NOT NULL THEN
    DROP POLICY IF EXISTS "service_sub_category_tags_admin" ON public.service_sub_category_tags;
    CREATE POLICY "service_sub_category_tags_admin" ON public.service_sub_category_tags FOR ALL
      USING (EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_sub_category_tags.service_id AND s.org_id = current_org_id()
                     AND current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])));
  END IF;
  IF to_regclass('public.sla_escalation_events') IS NOT NULL AND to_regclass('public.requests') IS NOT NULL THEN
    DROP POLICY IF EXISTS "esc_events_admin" ON public.sla_escalation_events;
    CREATE POLICY "esc_events_admin" ON public.sla_escalation_events FOR ALL
      USING ((EXISTS (SELECT 1 FROM public.requests r WHERE r.id = sla_escalation_events.request_id AND r.org_id = current_org_id()))
             AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])))
      WITH CHECK ((EXISTS (SELECT 1 FROM public.requests r WHERE r.id = sla_escalation_events.request_id AND r.org_id = current_org_id()))
             AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])));
  END IF;
END $$;

-- ── D-09 / A-26 / C-25 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_automation_state', 'program_pms_dates', 'program_pms_log'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- ── D-15 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The screen (lib/error-reporting.ts) sends its own user id and the organisation of its profile; status and the owner's note are the server's.
DO $$ BEGIN
  IF to_regclass('public.error_reports') IS NOT NULL THEN
    DROP POLICY IF EXISTS "error_reports_insert" ON public.error_reports;
    CREATE POLICY "error_reports_insert" ON public.error_reports FOR INSERT
      WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid() AND org_id IS NOT DISTINCT FROM current_org_id() AND status = 'new' AND owner_note IS NULL);
    -- generous length caps, NOT VALID: rows already there are never looked at, only new and changed rows
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'error_reports_length_chk' AND conrelid = 'public.error_reports'::regclass) THEN
      ALTER TABLE public.error_reports ADD CONSTRAINT error_reports_length_chk CHECK (
        length(message) <= 20000 AND length(coalesce(stack, '')) <= 100000 AND length(coalesce(url, '')) <= 4000 AND length(error_type) <= 100 AND length(app) <= 100
      ) NOT VALID;
    END IF;
  END IF;
END $$;

-- ── A-17 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- submitCsatRating (lib/actions/requests.ts) writes through the signed-in person's own session and changes exactly these three columns.
DO $$ BEGIN
  IF to_regclass('public.csat_surveys') IS NOT NULL THEN
    REVOKE UPDATE ON TABLE public.csat_surveys FROM authenticated;
    GRANT UPDATE (rating, comment, submitted_at) ON TABLE public.csat_surveys TO authenticated;
  END IF;
END $$;

-- ── D-18 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Drops index `dup` only when index `keep` on the same table has the same columns, order, operator classes, expression and WHERE, is valid,
-- and is at least as strict (a unique index may replace a plain one, never the other way round). `idx_request_activity_request` and
-- `idx_request_activity_req` are NOT touched: one is ascending and one descending, so they are not the same index.
CREATE OR REPLACE FUNCTION pg_temp.drop_duplicate_index(dup text, keep text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d record; k record;
BEGIN
  SELECT i.* INTO d FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = dup;
  SELECT i.* INTO k FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = keep;
  IF d.indexrelid IS NULL OR k.indexrelid IS NULL THEN RETURN; END IF;                                  -- one of them is not there: nothing to do
  IF d.indrelid <> k.indrelid OR d.indkey::text <> k.indkey::text OR d.indclass::text <> k.indclass::text OR d.indoption::text <> k.indoption::text THEN RETURN; END IF;
  IF coalesce(pg_get_expr(d.indpred, d.indrelid), '') <> coalesce(pg_get_expr(k.indpred, k.indrelid), '') THEN RETURN; END IF;
  IF coalesce(pg_get_expr(d.indexprs, d.indrelid), '') <> coalesce(pg_get_expr(k.indexprs, k.indrelid), '') THEN RETURN; END IF;
  IF NOT k.indisvalid OR d.indisunique OR d.indisprimary THEN RETURN; END IF;                            -- never drop a unique / primary index, never keep an invalid one
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = d.indexrelid) THEN RETURN; END IF;           -- an index that backs a constraint stays
  EXECUTE format('DROP INDEX IF EXISTS public.%I', dup);
END $f$;
SELECT pg_temp.drop_duplicate_index('idx_requests_created', 'idx_requests_created_at_desc');
SELECT pg_temp.drop_duplicate_index('idx_requests_intake_message', 'requests_one_per_intake_message');
SELECT pg_temp.drop_duplicate_index('idx_csat_request', 'csat_surveys_request_id_key');
SELECT pg_temp.drop_duplicate_index('idx_service_sub_category_tags_sub_category', 'service_sub_category_tags_sub_category_id_key');

-- ── D-19 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.add_fk_index(tbl text, col text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF to_regclass('public.' || tbl) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = tbl AND column_name = col) THEN RETURN; END IF;
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', 'idx_' || tbl || '_' || col, tbl, col);
END $f$;
SELECT pg_temp.add_fk_index('csat_surveys', 'requester_id');
SELECT pg_temp.add_fk_index('approval_email_codes', 'approver_id');
SELECT pg_temp.add_fk_index('approval_workflow_steps', 'approver_user_id');
SELECT pg_temp.add_fk_index('approvals', 'requested_by');
SELECT pg_temp.add_fk_index('intake_audit_log', 'actor_id');
SELECT pg_temp.add_fk_index('program_rows', 'org_id');
SELECT pg_temp.add_fk_index('program_issues', 'org_id');

-- ── D-21 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- request-attachments: the application refuses image/svg+xml (a link to an SVG can run its script); intake-attachments: the e-mail worker rejects a part with no
-- declared type, so application/octet-stream is never uploaded. The lists are otherwise left as they were.
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets SET allowed_mime_types = array_remove(allowed_mime_types, 'image/svg+xml')
      WHERE id = 'request-attachments' AND allowed_mime_types IS NOT NULL AND 'image/svg+xml' = ANY (allowed_mime_types);
    UPDATE storage.buckets SET allowed_mime_types = array_remove(allowed_mime_types, 'application/octet-stream')
      WHERE id = 'intake-attachments' AND allowed_mime_types IS NOT NULL AND 'application/octet-stream' = ANY (allowed_mime_types);
  END IF;
END $$;

-- ── D-27 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Same body as migration 160, plus a floor: Platform Settings already refuses fewer than 30 days; the database now refuses it too.
DO $mig$ BEGIN
  IF to_regclass('public.system_log') IS NOT NULL AND to_regclass('public.system_log_archive') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.system_log_archive_old(p_error_days integer DEFAULT 180, p_audit_years integer DEFAULT 7)
    RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
    DECLARE
      v_n bigint;
    BEGIN
      IF p_error_days IS NULL OR p_error_days < 30 OR p_audit_years IS NULL OR p_audit_years < 1 THEN
        RAISE EXCEPTION 'system_log_archive_old: keep at least 30 days of errors and 1 year of audit records' USING ERRCODE = '22023';
      END IF;
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
  END IF;
END $mig$;

-- ── A-05 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Ends every sign-in session of one person. The administrator API of the sign-in service can only end the CALLER'S session, so this is done here. Rows of
-- refresh_tokens go with their session (foreign key); the explicit delete also covers tokens that have no session row. Returns the number of sessions ended.
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_n integer := 0;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    DELETE FROM auth.refresh_tokens WHERE user_id::text = p_user_id::text;
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.revoke_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) TO service_role;

-- ── A-07 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Like rate_limit_hit (migration 170) but adds `p_amount` instead of 1: TRUE when the running total inside the window is OVER the limit. The upload budget
-- uses kilobytes as the unit, so 500 MB is 512,000 and fits the integer column.
CREATE OR REPLACE FUNCTION public.quota_add(p_key text, p_amount integer, p_limit integer, p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_total integer;
BEGIN
  IF p_key IS NULL OR p_amount < 0 OR p_limit < 1 OR p_window_seconds < 1 THEN RAISE EXCEPTION 'invalid quota call'; END IF;
  p_key := left(p_key, 200);
  INSERT INTO public.rate_limit_counters AS c (key, window_start, count) VALUES (p_key, now(), least(p_amount, p_limit + 1))
  ON CONFLICT (key) DO UPDATE SET
    count        = CASE WHEN c.window_start < now() - make_interval(secs => p_window_seconds) THEN least(p_amount, p_limit + 1)
                        ELSE least(c.count::bigint + p_amount, p_limit + 1)::integer END,
    window_start = CASE WHEN c.window_start < now() - make_interval(secs => p_window_seconds) THEN now() ELSE c.window_start END
  RETURNING c.count INTO v_total;
  RETURN v_total > p_limit;
END;
$function$;
REVOKE ALL ON FUNCTION public.quota_add(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quota_add(text, integer, integer, integer) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
