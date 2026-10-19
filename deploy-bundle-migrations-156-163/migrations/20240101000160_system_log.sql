-- System Log: one append-only record for the audit trail, security events, errors and events. LOCAL migration; NOT applied to production.
-- Design: docs/superpowers/specs/2026-10-14-system-log-design.md
--
--  * system_log is append-only (UPDATE / DELETE / TRUNCATE are refused by trigger; only system_log_archive_old() may move old rows to
--    system_log_archive). Client roles can only READ it (administrators and platform owners of their own organization).
--  * audit / security rows carry a hash chain (prev_hash, row_hash); system_log_verify_chain() reports the first broken link.
--  * database triggers write audit rows for configuration, security and structure tables and for ticket status / assignment changes,
--    so the trail exists even for direct database writes.
--  * existing audit tables are back-filled (idempotent) and left in place.

-- ── table ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  org_id         uuid,
  category       text NOT NULL CHECK (category IN ('audit', 'security', 'error', 'event')),
  source         text NOT NULL CHECK (source IN ('browser', 'app_server', 'server_action', 'api_route', 'cron', 'database', 'storage', 'auth', 'integration', 'admin', 'process', 'shipper')),
  severity       text NOT NULL DEFAULT 'info' CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  outcome        text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure', 'denied', 'unknown')),
  action         text NOT NULL,
  actor_id       uuid,
  actor_role     text,
  entity_type    text,
  entity_id      text,
  entity_label   text,
  before_data    jsonb,
  after_data     jsonb,
  message        text,
  error_code     text,
  stack          text,
  fingerprint    text,
  request_id     text,
  correlation_id text,
  session_id     text,
  path           text,
  method         text,
  ip             text,
  user_agent     text,
  from_click     boolean,
  click_target   text,
  detail         jsonb,
  legacy_ref     text UNIQUE,
  prev_hash      text,
  row_hash       text,
  chain_seq      bigint           -- position in the hash chain (audit / security rows), taken under a lock so the order is exact
);
ALTER TABLE public.system_log ADD COLUMN IF NOT EXISTS chain_seq bigint;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_log_chain_seq ON public.system_log (chain_seq) WHERE chain_seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_log_created ON public.system_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_log_org_created ON public.system_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_log_cat_sev ON public.system_log (category, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_log_source ON public.system_log (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_log_actor ON public.system_log (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_log_entity ON public.system_log (entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_log_fingerprint ON public.system_log (fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_log_request ON public.system_log (request_id) WHERE request_id IS NOT NULL;

-- the archive has the same columns (no identity, no uniqueness): old rows are moved here, never dropped
CREATE TABLE IF NOT EXISTS public.system_log_archive (LIKE public.system_log INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE public.system_log_archive DROP CONSTRAINT IF EXISTS system_log_archive_legacy_ref_key;
ALTER TABLE public.system_log_archive ADD COLUMN IF NOT EXISTS chain_seq bigint;

-- ── append-only protection ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.system_log_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- only system_log_archive_old() may delete (it moves the rows to the archive first)
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'system_log' AND current_setting('citykart.system_log_archive', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: rows cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_system_log_guard ON public.system_log;
CREATE TRIGGER trg_system_log_guard BEFORE UPDATE OR DELETE ON public.system_log FOR EACH ROW EXECUTE FUNCTION public.system_log_guard();
DROP TRIGGER IF EXISTS trg_system_log_guard_truncate ON public.system_log;
CREATE TRIGGER trg_system_log_guard_truncate BEFORE TRUNCATE ON public.system_log FOR EACH STATEMENT EXECUTE FUNCTION public.system_log_guard();
DROP TRIGGER IF EXISTS trg_system_log_archive_guard ON public.system_log_archive;
CREATE TRIGGER trg_system_log_archive_guard BEFORE UPDATE OR DELETE ON public.system_log_archive FOR EACH ROW EXECUTE FUNCTION public.system_log_guard();
DROP TRIGGER IF EXISTS trg_system_log_archive_guard_truncate ON public.system_log_archive;
CREATE TRIGGER trg_system_log_archive_guard_truncate BEFORE TRUNCATE ON public.system_log_archive FOR EACH STATEMENT EXECUTE FUNCTION public.system_log_guard();

-- ── hash chain (audit and security rows) ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.system_log_hash_input(r public.system_log)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT concat_ws('|', r.id::text, to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(r.org_id::text, ''), r.category, r.source,
    r.action, coalesce(r.actor_id::text, ''), coalesce(r.entity_type, ''), coalesce(r.entity_id, ''), coalesce(r.before_data::text, ''),
    coalesce(r.after_data::text, ''), coalesce(r.message, ''), r.outcome, coalesce(r.chain_seq::text, ''))
$function$;

-- The head of the chain: one row, locked by every chained insert until its transaction ends, so two writers can never chain to the same
-- predecessor and the order is exactly the order of chain_seq (the row ids are NOT reliable for this: ids are handed out before the lock).
CREATE TABLE IF NOT EXISTS public.system_log_chain_head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  seq       bigint NOT NULL DEFAULT 0,
  hash      text   NOT NULL DEFAULT 'genesis'
);
INSERT INTO public.system_log_chain_head (singleton) VALUES (true) ON CONFLICT DO NOTHING;
REVOKE ALL ON public.system_log_chain_head FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.system_log_chain_head TO service_role;

CREATE OR REPLACE FUNCTION public.system_log_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seq bigint;
  v_prev text;
BEGIN
  IF NEW.category IN ('audit', 'security') AND NEW.legacy_ref IS NULL THEN
    SELECT seq, hash INTO v_seq, v_prev FROM public.system_log_chain_head WHERE singleton FOR UPDATE;
    NEW.chain_seq := v_seq + 1;
    NEW.prev_hash := v_prev;
    NEW.row_hash := encode(sha256(convert_to(NEW.prev_hash || '|' || public.system_log_hash_input(NEW), 'UTF8')), 'hex');
    UPDATE public.system_log_chain_head SET seq = NEW.chain_seq, hash = NEW.row_hash WHERE singleton;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_system_log_chain ON public.system_log;
CREATE TRIGGER trg_system_log_chain BEFORE INSERT ON public.system_log FOR EACH ROW EXECUTE FUNCTION public.system_log_chain();

-- first broken link of the chain (in chain order), or no rows when it is intact
DROP FUNCTION IF EXISTS public.system_log_verify_chain(bigint, integer);
CREATE OR REPLACE FUNCTION public.system_log_verify_chain(p_from_seq bigint DEFAULT 0, p_limit integer DEFAULT 500000)
 RETURNS TABLE (broken_id bigint, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.system_log%ROWTYPE;
  v_prev text;
  v_prev_seq bigint;
  v_first boolean := true;
  v_expected text;
BEGIN
  -- records moved to the archive are still part of the chain
  FOR r IN SELECT * FROM (SELECT * FROM public.system_log UNION ALL SELECT * FROM public.system_log_archive) a WHERE a.row_hash IS NOT NULL AND a.chain_seq >= p_from_seq ORDER BY a.chain_seq LIMIT p_limit LOOP
    IF v_first THEN
      v_first := false;
    ELSIF r.chain_seq <> v_prev_seq + 1 THEN
      RETURN QUERY SELECT r.id, 'a record is missing before this one'::text;
      RETURN;
    ELSIF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN QUERY SELECT r.id, 'the previous record was changed'::text;
      RETURN;
    END IF;
    v_expected := encode(sha256(convert_to(r.prev_hash || '|' || public.system_log_hash_input(r), 'UTF8')), 'hex');
    IF v_expected IS DISTINCT FROM r.row_hash THEN
      RETURN QUERY SELECT r.id, 'the record content does not match its hash'::text;
      RETURN;
    END IF;
    v_prev := r.row_hash;
    v_prev_seq := r.chain_seq;
  END LOOP;
  RETURN;
END;
$function$;

-- ── retention: move old rows to the archive (never drop) ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.system_log_archive_old(p_error_days integer DEFAULT 180, p_audit_years integer DEFAULT 7)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- ── permissions: read-only for administrators of the same organization; everything else is the server's own client ───────────────
ALTER TABLE public.system_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_log_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_log, public.system_log_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.system_log TO authenticated;
GRANT ALL ON public.system_log, public.system_log_archive TO service_role;

DROP POLICY IF EXISTS "system_log_select" ON public.system_log;
CREATE POLICY "system_log_select" ON public.system_log FOR SELECT
  USING (
    (SELECT current_user_role()) = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])
    AND (org_id = (SELECT current_org_id()) OR (org_id IS NULL AND (SELECT current_user_role()) = 'platform_owner'::user_role))
  );

REVOKE ALL ON FUNCTION public.system_log_verify_chain(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_log_verify_chain(bigint, integer) TO service_role;
REVOKE ALL ON FUNCTION public.system_log_archive_old(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_log_archive_old(integer, integer) TO service_role;

-- ── generic audit trigger ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- helper: drop secret-looking columns and shorten very long values
CREATE OR REPLACE FUNCTION public.system_log_clean(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_object_agg(
    k,
    CASE
      WHEN k ~* '(pass(word)?|secret|token|api[_-]?key|credential|vault|private[_-]?key|otp|code_hash)' THEN '"[redacted]"'::jsonb
      WHEN jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 1000 THEN to_jsonb(left(v #>> '{}', 1000) || '…')
      WHEN length(v::text) > 3000 THEN to_jsonb(left(v::text, 3000) || '…')
      ELSE v
    END), '{}'::jsonb)
  FROM jsonb_each(coalesce(p, '{}'::jsonb)) AS t(k, v)
$function$;

-- TG_ARGV[0] = comma list of columns to watch on UPDATE (empty = all), TG_ARGV[1] = 'security' for the security category,
-- TG_ARGV[2] = comma list of the only columns to record on INSERT / DELETE ('light' mode; empty = all)
CREATE OR REPLACE FUNCTION public.system_log_audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_watch    text[] := CASE WHEN coalesce(TG_ARGV[0], '') = '' THEN NULL ELSE string_to_array(TG_ARGV[0], ',') END;
  v_category text   := CASE WHEN TG_ARGV[1] = 'security' THEN 'security' ELSE 'audit' END;
  v_light    text[] := CASE WHEN coalesce(TG_ARGV[2], '') = '' THEN NULL ELSE string_to_array(TG_ARGV[2], ',') END;
  v_noise    text[] := ARRAY['updated_at', 'last_assigned_index', 'last_login_at', 'last_seen_at', 'last_polled_at', 'last_sync_at', 'last_used_at', 'search_vector'];
  v_old jsonb; v_new jsonb; v_row jsonb;
  v_before jsonb := NULL; v_after jsonb := NULL;
  v_changed text[];
  k text;
  v_actor uuid;
  v_role text;
  v_headers jsonb;
  v_request text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_row := v_new;
    v_after := public.system_log_clean(CASE WHEN v_light IS NULL THEN v_new ELSE (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(v_new) WHERE key = ANY (v_light)) END);
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_row := v_old;
    v_before := public.system_log_clean(CASE WHEN v_light IS NULL THEN v_old ELSE (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(v_old) WHERE key = ANY (v_light)) END);
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_row := v_new;
    v_changed := ARRAY[]::text[];
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF NOT (k = ANY (v_noise)) AND (v_watch IS NULL OR k = ANY (v_watch)) AND (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN
        v_changed := v_changed || k;
      END IF;
    END LOOP;
    IF coalesce(array_length(v_changed, 1), 0) = 0 THEN RETURN NEW; END IF;
    v_before := public.system_log_clean((SELECT jsonb_object_agg(key, value) FROM jsonb_each(v_old) WHERE key = ANY (v_changed)));
    v_after  := public.system_log_clean((SELECT jsonb_object_agg(key, value) FROM jsonb_each(v_new) WHERE key = ANY (v_changed)));
  END IF;

  BEGIN v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'; EXCEPTION WHEN OTHERS THEN v_role := NULL; END;
  v_role := coalesce(v_role, session_user);
  IF v_role = 'service_role' THEN
    -- The server's own client (it bypasses row security, so auth.uid() is empty) names the person it is acting for in the x-actor-id header.
    -- Trusted ONLY for the service role: a signed-in user's token cannot make a change look like someone else's.
    BEGIN v_headers := nullif(current_setting('request.headers', true), '')::jsonb; EXCEPTION WHEN OTHERS THEN v_headers := NULL; END;
    IF (v_headers ->> 'x-actor-id') ~* '^[0-9a-f-]{36}$' THEN v_actor := (v_headers ->> 'x-actor-id')::uuid; END IF;
    v_request := nullif(left(v_headers ->> 'x-request-id', 80), '');
  ELSE
    BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  END IF;

  INSERT INTO public.system_log (org_id, category, source, severity, outcome, action, actor_id, actor_role, entity_type, entity_id, entity_label, before_data, after_data, detail, request_id)
  VALUES (
    CASE WHEN (v_row ->> 'org_id') ~* '^[0-9a-f-]{36}$' THEN (v_row ->> 'org_id')::uuid END,
    v_category, 'database', 'info', 'success',
    TG_TABLE_NAME || '.' || lower(TG_OP),
    v_actor, v_role, TG_TABLE_NAME,
    coalesce(v_row ->> 'id', nullif(concat_ws(':', v_row ->> 'team_id', v_row ->> 'user_id', v_row ->> 'request_id'), '')),
    left(coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'full_name', v_row ->> 'email', v_row ->> 'request_no', v_row ->> 'slug', v_row ->> 'code', v_row ->> 'key', v_row ->> 'file_name'), 200),
    v_before, v_after,
    CASE WHEN v_changed IS NULL THEN NULL ELSE jsonb_build_object('changed_columns', to_jsonb(v_changed)) END,
    v_request
  );
  RETURN coalesce(NEW, OLD);
END;
$function$;

-- attach it (tables that do not exist in a given database are skipped)
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    -- table, watched UPDATE columns, category, light-mode columns for INSERT / DELETE
    ('profiles', 'role,is_active,org_id,manager_id,store_id,department_id,location_id,function_id,designation_id,cost_center_id,employee_id,job_title,must_reset_password,whatsapp_enabled,full_name', 'security', 'id,org_id,full_name,email,role,is_active,manager_id,store_id,department_id'),
    ('custom_roles', '', 'security', ''),
    ('permission_overrides', '', 'security', ''),
    ('organizations', '', 'security', ''),
    ('org_module_access', '', 'security', ''),
    ('license_keys', '', 'security', ''),
    ('email_smtp_settings', '', 'security', ''),
    ('intake_channels', '', 'security', 'id,org_id,type,name,status'),
    ('teams', '', 'audit', ''), ('team_members', '', 'audit', ''),
    ('services', '', 'audit', 'id,org_id,name,slug,team_id,category_id'), ('service_categories', '', 'audit', ''), ('service_sub_categories', '', 'audit', ''),
    ('sla_policies', '', 'audit', ''), ('global_sla_config', '', 'audit', ''), ('field_sla_overrides', '', 'audit', ''),
    ('sla_escalation_rules', '', 'audit', ''), ('escalation_policies', '', 'audit', ''), ('alert_rules', '', 'audit', ''), ('assignment_rules', '', 'audit', ''),
    ('business_rules', '', 'audit', ''), ('business_hours', '', 'audit', ''), ('holidays', '', 'audit', ''), ('app_settings', '', 'audit', ''),
    ('retention_policies', '', 'audit', ''), ('request_priorities', '', 'audit', ''), ('task_statuses', '', 'audit', ''), ('task_priorities', '', 'audit', ''),
    ('departments', '', 'audit', ''), ('locations', '', 'audit', ''), ('designations', '', 'audit', ''), ('job_functions', '', 'audit', ''),
    ('cost_centers', '', 'audit', ''), ('stores', '', 'audit', 'id,org_id,code,name'), ('oems', '', 'audit', ''),
    ('approval_workflows', '', 'audit', ''), ('approval_workflow_steps', '', 'audit', ''),
    ('notification_rules', '', 'audit', ''), ('scheduled_reports', '', 'audit', ''), ('form_templates', '', 'audit', 'id,org_id,name'), ('form_field_library', '', 'audit', 'id,org_id,name'),
    ('requests', 'status,assigned_to,priority,team_id,requester_id,service_id,resolved_at,closed_at,reopen_count', 'audit', 'id,org_id,request_no,status,priority,team_id,service_id,requester_id,assigned_to'),
    ('request_attachments', 'deleted_at,is_internal', 'audit', 'id,request_id,file_name,file_size,mime_type,uploaded_by,deleted_at'),
    ('request_collaborators', '', 'audit', ''),
    ('approvals', 'status,current_step,workflow_id', 'audit', 'id,request_id,workflow_id,status,current_step')
  ) AS x(tbl, watch, cat, light) LOOP
    IF to_regclass('public.' || t.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_system_log_audit ON public.%I', t.tbl);
      EXECUTE format('CREATE TRIGGER trg_system_log_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.system_log_audit_trigger(%L, %L, %L)',
                     t.tbl, t.watch, t.cat, t.light);
    END IF;
  END LOOP;
END $$;

-- ── back-fill from the existing records (idempotent; originals are left in place) ───────────────────────────────────────────────
-- (written by the table owner, so no hash chain: legacy rows are marked with legacy_ref and are not chained)
INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, entity_type, entity_id, after_data, legacy_ref)
SELECT a.created_at, a.org_id, 'audit', 'admin', 'info', 'success', a.action, a.actor_id, a.entity_type, a.entity_id::text, a.metadata, 'admin_audit_log:' || a.id
FROM public.admin_audit_log a
WHERE NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'admin_audit_log:' || a.id)
  AND NOT EXISTS (SELECT 1 FROM public.system_log_archive s WHERE s.legacy_ref = 'admin_audit_log:' || a.id);

INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, entity_type, entity_id, after_data, legacy_ref)
SELECT a.created_at, r.org_id, 'audit', 'server_action', 'info', 'success', 'request.' || a.action::text, a.actor_id, 'request', a.request_id::text, a.metadata, 'request_activity:' || a.id
FROM public.request_activity a JOIN public.requests r ON r.id = a.request_id
WHERE NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'request_activity:' || a.id)
  AND NOT EXISTS (SELECT 1 FROM public.system_log_archive s WHERE s.legacy_ref = 'request_activity:' || a.id);

DO $$
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'org_id') THEN
    INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, entity_type, entity_id, after_data, legacy_ref)
    SELECT a.created_at, t.org_id, 'audit', 'server_action', 'info', 'success', 'task.' || a.action::text, a.actor_id, 'task', a.task_id::text, a.metadata, 'task_activity:' || a.id
    FROM public.task_activity a JOIN public.tasks t ON t.id = a.task_id
    WHERE NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'task_activity:' || a.id);
  END IF;
END $$;

INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, entity_type, entity_id, after_data, legacy_ref)
SELECT a.created_at, a.org_id, 'audit', 'server_action', 'info', 'success', 'project.' || a.action, a.actor_id, 'project', a.project_id::text, a.metadata, 'project_activity:' || a.id
FROM public.project_activity a
WHERE NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'project_activity:' || a.id);

INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, entity_type, entity_id, after_data, legacy_ref)
SELECT a.created_at, a.org_id, 'audit', 'integration', 'info', 'success', a.action, a.actor_id, a.entity_type, a.entity_id::text, a.metadata, 'intake_audit_log:' || a.id
FROM public.intake_audit_log a
WHERE NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'intake_audit_log:' || a.id);

INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, entity_type, after_data, legacy_ref)
SELECT a.created_at, a.org_id, 'security', 'admin', 'info', 'success', a.action, a.actor_id, 'organization', a.metadata, 'owner_audit_log:' || a.id
FROM public.owner_audit_log a
WHERE NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'owner_audit_log:' || a.id);

INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, message, stack, path, detail, legacy_ref)
SELECT e.created_at, e.org_id, 'error', 'browser', 'error', 'failure', 'browser.' || e.error_type, e.user_id, left(e.message, 2000), left(e.stack, 8000), e.url, e.metadata, 'error_reports:' || e.id
FROM public.error_reports e
WHERE NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'error_reports:' || e.id);

INSERT INTO public.system_log (created_at, org_id, category, source, severity, outcome, action, actor_id, message, path, session_id, user_agent, click_target, detail, legacy_ref)
SELECT e.created_at, e.org_id, 'error', CASE WHEN e.kind = 'server_error' THEN 'app_server' ELSE 'browser' END, 'error', 'failure', 'event.' || e.kind, e.user_id,
       left(e.message, 2000), e.path, e.session_id, e.user_agent, e.target, e.detail, 'app_event_log:' || e.id
FROM public.app_event_log e
WHERE e.kind IN ('js_error', 'render_error', 'server_error')
  AND NOT EXISTS (SELECT 1 FROM public.system_log s WHERE s.legacy_ref = 'app_event_log:' || e.id);

-- ── deleting an organization must not erase its audit trail ───────────────────────────────────────────────────────────────────────
-- owner_delete_org() runs with triggers switched off (session_replication_role = replica) and deletes every row that has an org_id,
-- which would also delete that organization's system_log rows and break the hash chain. The log tables are now skipped.
CREATE OR REPLACE FUNCTION public.owner_delete_org(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  r RECORD;
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND NOT is_owner_org() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM organizations WHERE id = p_org_id;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Organization not found');
  END IF;

  SET LOCAL session_replication_role = replica;

  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'org_id' AND table_name NOT IN ('organizations', 'system_log', 'system_log_archive')
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', r.table_name) USING p_org_id;
  END LOOP;

  DELETE FROM organizations WHERE id = p_org_id;

  SET LOCAL session_replication_role = DEFAULT;

  RETURN jsonb_build_object('ok', true, 'deleted', v_name);
END;
$function$;
REVOKE ALL ON FUNCTION public.owner_delete_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_org(uuid) TO service_role;
