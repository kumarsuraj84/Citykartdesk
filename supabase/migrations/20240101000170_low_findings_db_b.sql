-- 170: database part of the remaining Low findings, batch B (VAPT-036, 042, 044, 051, 065 and the privacy findings 019 / 021 as they are added below).
-- LOCAL ONLY until released. Safe to run twice. Rollback: supabase/rollback/170_low_findings_db_b_rollback.sql
--
-- Release order: the application that uses these objects can be live BEFORE this migration (it falls back to its in-memory counters and writes push
-- subscriptions with the server's key); the migration can then be applied at any time.

BEGIN;

-- The privileges changed below are written down first, so the rollback restores exactly what was there.
CREATE TABLE IF NOT EXISTS public._grant_snapshots (
  stage text NOT NULL, kind text NOT NULL, grantee text NOT NULL, object_name text NOT NULL, privilege text NOT NULL,
  PRIMARY KEY (stage, kind, grantee, object_name, privilege)
);
ALTER TABLE public._grant_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._grant_snapshots FROM PUBLIC, anon, authenticated;

INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege)
SELECT '170', 'table', 'anon', c.relname, '-'
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relname IN ('push_subscriptions', 'profiles')
ON CONFLICT DO NOTHING;
INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege)
SELECT '170', 'table', r.rolname, c.relname, a.privilege_type
FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND r.rolname IN ('anon', 'authenticated') AND c.relname IN ('push_subscriptions', 'profiles')
ON CONFLICT DO NOTHING;
INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege)
SELECT '170', 'column', r.rolname, c.relname || '.' || t.attname, a.privilege_type
FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid AND t.attnum > 0 AND NOT t.attisdropped CROSS JOIN LATERAL aclexplode(t.attacl) a JOIN pg_roles r ON r.oid = a.grantee
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND r.rolname IN ('anon', 'authenticated') AND c.relname IN ('push_subscriptions', 'profiles')
ON CONFLICT DO NOTHING;

-- ── VAPT-061 / VA-DB-10: a display name is changed through the application only ──────────────────────────────────────────────────────────────
-- The application now checks the name (allowed characters, length, no look-alike of a staff member) and records the change. A signed-in user could skip
-- those checks by writing the column through the data API, so the direct right to change full_name and avatar_url is removed; the server writes them.
REVOKE UPDATE (full_name, avatar_url) ON public.profiles FROM authenticated;

-- ── VAPT-036 / D-025: a push-notification address is stored by the server only ───────────────────────────────────────────────────────────────────
-- The server later posts to the stored address. The application checks the address before it saves it, but a signed-in user could skip that check by writing
-- to the table through the data API. Now only the server writes (after the check); a user still reads their own rows.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.push_subscriptions FROM authenticated, anon;

-- ── Counters that survive a restart and are shared by every application process (used by the public endpoints) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer NOT NULL DEFAULT 1
);
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_counters FROM PUBLIC, anon, authenticated;

-- TRUE when this call is OVER the limit. One atomic statement, so parallel callers are counted correctly.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_count integer;
BEGIN
  IF p_key IS NULL OR p_limit < 1 OR p_window_seconds < 1 THEN RAISE EXCEPTION 'invalid rate limit call'; END IF;
  p_key := left(p_key, 200);
  INSERT INTO public.rate_limit_counters AS c (key, window_start, count) VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    count        = CASE WHEN c.window_start < now() - make_interval(secs => p_window_seconds) THEN 1 ELSE c.count + 1 END,
    window_start = CASE WHEN c.window_start < now() - make_interval(secs => p_window_seconds) THEN now() ELSE c.window_start END
  RETURNING c.count INTO v_count;
  IF random() < 0.01 THEN DELETE FROM public.rate_limit_counters WHERE window_start < now() - interval '1 day'; END IF;
  RETURN v_count > p_limit;
END;
$function$;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;

-- ── Replay guard for incoming webhook deliveries ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_seen (
  key     text PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.webhook_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_seen FROM PUBLIC, anon, authenticated;

-- TRUE the first time a key is seen inside the window (or after the window has passed); FALSE for a repeat.
CREATE OR REPLACE FUNCTION public.webhook_seen_once(p_key text, p_ttl_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_first boolean;
BEGIN
  IF p_key IS NULL OR p_ttl_seconds < 1 THEN RAISE EXCEPTION 'invalid webhook_seen_once call'; END IF;
  p_key := left(p_key, 300);
  INSERT INTO public.webhook_seen AS w (key, seen_at) VALUES (p_key, now())
  ON CONFLICT (key) DO UPDATE SET seen_at = now() WHERE w.seen_at < now() - make_interval(secs => p_ttl_seconds)
  RETURNING true INTO v_first;
  IF random() < 0.01 THEN DELETE FROM public.webhook_seen WHERE seen_at < now() - interval '7 days'; END IF;
  RETURN coalesce(v_first, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.webhook_seen_once(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_seen_once(text, integer) TO service_role;

-- ── VAPT-019 / VA-DB-07 (rest): an ordinary user sees only the people they actually deal with ────────────────────────────────────────────────
-- Until now every signed-in person could list the whole organisation's staff (names and roles) through the data API. Staff (technician and above) still see
-- everybody, because assigning, approving and collaborating need it. A person with the role "user" now sees: themself, their own manager, their direct and
-- indirect reports, and the people who appear on the tickets they raised or take part in (the technician, commenters, collaborators, approvers, people who
-- acted on it), plus whoever started a notification they hold. The ticket screens read these names through joins, so they keep working.
CREATE OR REPLACE FUNCTION public.current_user_visible_people() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH my_reqs AS (
    SELECT r.id, r.requester_id, r.assigned_to FROM requests r
    WHERE r.org_id = current_org_id()
      AND (r.requester_id = auth.uid() OR r.id = ANY (current_user_collab_request_ids()) OR r.id = ANY (current_user_approver_request_ids()))
  )
  SELECT coalesce(array_agg(DISTINCT p), '{}'::uuid[]) FROM (
    SELECT auth.uid() AS p
    UNION SELECT manager_id FROM profiles WHERE id = auth.uid()
    UNION SELECT unnest(current_user_subordinate_ids())
    UNION SELECT requester_id FROM my_reqs
    UNION SELECT assigned_to FROM my_reqs
    UNION SELECT c.author_id FROM request_comments c JOIN my_reqs m ON m.id = c.request_id WHERE NOT c.is_internal
    UNION SELECT a.actor_id FROM request_activity a JOIN my_reqs m ON m.id = a.request_id
    UNION SELECT cl.user_id FROM request_collaborators cl JOIN my_reqs m ON m.id = cl.request_id
    UNION SELECT s.approver_user_id FROM approvals ap JOIN my_reqs m ON m.id = ap.request_id JOIN approval_workflow_steps s ON s.workflow_id = ap.workflow_id
    UNION SELECT d.decided_by FROM approval_decisions d JOIN approvals ap ON ap.id = d.approval_id JOIN my_reqs m ON m.id = ap.request_id
    UNION SELECT n.actor_id FROM notifications n WHERE n.user_id = auth.uid()
  ) x WHERE p IS NOT NULL
$function$;
REVOKE ALL ON FUNCTION public.current_user_visible_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_visible_people() TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (
  id = auth.uid()
  OR (org_id = current_org_id() AND (current_user_role() <> 'user' OR id = ANY (current_user_visible_people())))
);

-- ── VAPT-021 / VA-DB-06 (rest): a file can be read only through the attachment row of ITS OWN ticket ────────────────────────────────────────────
-- The file-store read rule granted access when ANY attachment row pointed at the file and the person could see that row's ticket. A requester could create a
-- row on their own ticket that pointed at another ticket's file and then read it. Now (a) a row's file path must start with its own ticket's id, and (b) the
-- read rule requires the same, so a forged or legacy row of that kind opens nothing.
DROP POLICY IF EXISTS request_attachments_insert ON public.request_attachments;
CREATE POLICY request_attachments_insert ON public.request_attachments FOR INSERT WITH CHECK (
  (uploaded_by = auth.uid())
  AND starts_with(storage_path, request_id::text || '/')
  AND (EXISTS (
    SELECT 1 FROM requests r
    WHERE ((r.id = request_attachments.request_id) AND (r.org_id = current_org_id())
      AND ((r.requester_id = auth.uid()) OR is_team_member(r.team_id) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])) OR is_request_collaborator(r.id))))
  )
);
DROP POLICY IF EXISTS storage_request_attachments_select ON storage.objects;
CREATE POLICY storage_request_attachments_select ON storage.objects FOR SELECT USING (
  (bucket_id = 'request-attachments'::text) AND (EXISTS (
    SELECT 1 FROM request_attachments ra
    WHERE ((ra.storage_path = objects.name) AND split_part(objects.name, '/', 1) = ra.request_id::text AND (ra.deleted_at IS NULL) AND (EXISTS (
      SELECT 1 FROM requests r
      WHERE ((r.id = ra.request_id) AND (r.org_id = current_org_id()) AND (((r.requester_id = auth.uid()) AND (ra.is_internal = false)) OR is_team_member(r.team_id) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))))))))
);

-- ── VAPT-048 / VA-ADM-12: the field SLA function refuses a service of another organisation ─────────────────────────────────────────────────────
-- (only the server can call it; the check is a second barrier. ON CONFLICT would otherwise update another organisation's row for the same service.)
CREATE OR REPLACE FUNCTION public.upsert_field_sla_override(p_org_id uuid, p_service_id uuid, p_field_id text, p_field_label text, p_option_value text, p_option_label text, p_priority text, p_response_hours numeric, p_resolution_hours numeric, p_updated_by uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM services WHERE id = p_service_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'The service does not belong to this organisation.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_response_hours IS NOT NULL AND p_resolution_hours IS NOT NULL AND p_resolution_hours <= p_response_hours THEN
    RAISE EXCEPTION 'Resolution SLA (%h) must be greater than Response SLA (%h).', p_resolution_hours, p_response_hours
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO field_sla_overrides (
    org_id, service_id, field_id, field_label, option_value, option_label, sla_config, updated_by, updated_at
  )
  VALUES (
    p_org_id, p_service_id, p_field_id, p_field_label, p_option_value, p_option_label,
    jsonb_build_object(p_priority, jsonb_build_object('response_hours', p_response_hours, 'resolution_hours', p_resolution_hours)),
    p_updated_by, now()
  )
  ON CONFLICT (service_id, field_id, option_value) DO UPDATE
  SET sla_config = jsonb_set(
        coalesce(field_sla_overrides.sla_config, '{}'::jsonb),
        ARRAY[p_priority],
        jsonb_build_object('response_hours', p_response_hours, 'resolution_hours', p_resolution_hours),
        true
      ),
      field_label = p_field_label,
      option_label = p_option_label,
      updated_by = p_updated_by,
      updated_at = now()
  WHERE field_sla_overrides.org_id = p_org_id;
END;
$function$;

COMMIT;
