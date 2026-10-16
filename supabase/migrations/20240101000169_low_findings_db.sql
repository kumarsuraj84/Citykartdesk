-- 169: database part of the remaining Low findings (VAPT-062, VAPT-063, VAPT-064 rest).
-- Safe to run twice. Rollback: supabase/rollback/169_low_findings_db_rollback.sql.

-- ── VAPT-063 / VA-TKT-20: the full activity log of a ticket is for staff ─────────────────────────────────────────────────────────────────────
-- The log carries rule names, copied e-mail addresses (OEM contacts included), approver names and remarks. A requester (role "user") no longer reads
-- the rows through the data API; the ticket page asks the server, which checks that the person may see the ticket and then returns only the fields
-- the History tab shows (lib/activity-public.ts). Staff (any role above "user") are unchanged.
DROP POLICY IF EXISTS "request_activity_select" ON request_activity;
CREATE POLICY "request_activity_select" ON request_activity FOR SELECT USING (
  current_user_role() IS NOT NULL
  AND current_user_role() <> 'user'
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
);

-- ── VAPT-062 / VA-DB-09 / VA-TKT-19: the home dashboard no longer trusts the caller's role flags ──────────────────────────────────────────────
-- The old function becomes an internal one nobody can call through the data API. The public function works out the real role itself: the caller's
-- flags can only switch things OFF, never on. It also counts the caller's pending approvals inside their own organisation only.
DO $$
BEGIN
  IF to_regprocedure('public.get_home_dashboard_core(boolean,boolean,uuid,boolean)') IS NULL THEN
    ALTER FUNCTION public.get_home_dashboard(boolean, boolean, uuid, boolean) RENAME TO get_home_dashboard_core;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.get_home_dashboard_core(boolean, boolean, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_home_dashboard(
  p_is_manager boolean DEFAULT false,
  p_is_agent   boolean DEFAULT false,
  p_team_id    uuid    DEFAULT NULL,
  p_has_tasks  boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text := current_user_role()::text;
  v_org     uuid := current_org_id();
  v_mgr     boolean;
  v_agent   boolean;
  v_pending bigint;
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_org IS NULL THEN
    RETURN '{}'::json;
  END IF;
  v_mgr   := p_is_manager AND v_role IN ('manager', 'admin', 'platform_owner');
  v_agent := p_is_agent   AND v_role IN ('agent', 'manager', 'admin', 'platform_owner');

  v_result := public.get_home_dashboard_core(v_mgr, v_agent, p_team_id, p_has_tasks)::jsonb;

  SELECT COUNT(*) INTO v_pending
  FROM   approvals a
  JOIN   approval_workflow_steps aws ON aws.workflow_id = a.workflow_id AND aws.step_order = a.current_step
  JOIN   requests r ON r.id = a.request_id
  WHERE  a.status = 'pending'
    AND  r.org_id = v_org
    AND  (aws.approver_user_id = v_uid OR (aws.approver_type = 'any_manager' AND v_mgr));

  RETURN jsonb_set(v_result, '{counts,pending_approvals}', to_jsonb(v_pending))::json;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_home_dashboard(boolean, boolean, uuid, boolean) TO authenticated, service_role;

-- ── VAPT-064 / VA-DB-12: functions are not public by default ─────────────────────────────────────────────────────────────────────────────────
-- Until now every function of this application's own had EXECUTE for "anyone" (PUBLIC), which includes the anonymous role. Where a function was open to
-- everyone, signed-in users and the server keep their access by name and PUBLIC and the anonymous role lose it. Functions that earlier migrations had
-- already locked (internal ones: ticket numbers, credentials, retention, organisation delete ...) are NOT opened by this step. Row-security policies keep
-- working: they run as the signed-in user, who keeps EXECUTE. The list of functions changed here is kept in _m169_function_grants so the rollback can put
-- back exactly these and nothing else.
CREATE TABLE IF NOT EXISTS public._m169_function_grants (sig text PRIMARY KEY);
ALTER TABLE public._m169_function_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._m169_function_grants FROM PUBLIC, anon, authenticated;

DO $$
DECLARE r record; v_public boolean;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig, p.proacl
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND p.prokind IN ('f', 'p')
      AND  NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    -- open to everyone = no access list at all (the default) or an entry for PUBLIC (grantee 0)
    v_public := r.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(r.proacl) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE');
    IF v_public THEN
      INSERT INTO public._m169_function_grants (sig) VALUES (r.sig::text) ON CONFLICT DO NOTHING;
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
