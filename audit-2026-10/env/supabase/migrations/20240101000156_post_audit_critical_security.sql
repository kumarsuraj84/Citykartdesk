-- Post-audit remediation, Critical database findings (audit report 2026-10-13: D-002, D-003, D-007).
-- LOCAL migration, additive/tightening only (no table is rewritten, no data is changed). Prepared for later review; NOT applied to production.
--
-- D-002  owner_delete_org(uuid) was callable by anyone with the public API key and deleted a whole organization.
-- D-007  generate_request_no() and seed_default_sla_config(uuid) were also callable by anyone.
-- D-003  A signed-in user could rewrite their own profile row (organization, active flag, manager, employee id; an admin could make
--        themselves platform_owner). Now a signed-in user can change only their own name, avatar, and clear their own "must reset password" flag.
--
-- Rollback: see audit-2026-10/remediation/11-CHANGE-AND-ROLLBACK-PLAN.md (restores the previous grants; the previous behaviour is the vulnerability).

-- ── D-002: only the server (service_role) may delete an organization; and the function now checks its caller itself ───────────────
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
  -- Defence in depth: a request that arrives as a signed-in or anonymous API user must be the owner organization's admin.
  -- (Server calls with the service key, and direct database sessions, have no such client role and pass.)
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
    WHERE table_schema = 'public' AND column_name = 'org_id' AND table_name <> 'organizations'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', r.table_name) USING p_org_id;
  END LOOP;

  DELETE FROM organizations WHERE id = p_org_id;

  SET LOCAL session_replication_role = DEFAULT;

  RETURN jsonb_build_object('ok', true, 'deleted', v_name);
END;
$function$;

-- The earlier REVOKEs named anon/authenticated but left the default PUBLIC grant in place; revoke PUBLIC too.
REVOKE ALL ON FUNCTION public.owner_delete_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_org(uuid) TO service_role;

-- ── D-007: internal helpers are not part of the public API ──────────────────────────────────────────────────────────────────────
-- generate_request_no() is called by the ticket-number trigger. That trigger ran as the inserting user, so it is made SECURITY DEFINER
-- first (it only fills in the ticket number), and then direct calls to the function are closed.
CREATE OR REPLACE FUNCTION public.trg_assign_request_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.request_no := generate_request_no();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_request_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_request_no() TO service_role;
REVOKE ALL ON FUNCTION public.seed_default_sla_config(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_sla_config(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_seed_org_sla_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_seed_org_sla_config() TO service_role;
REVOKE ALL ON FUNCTION public.trg_assign_request_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_assign_request_no() TO service_role;

-- ── D-003: a signed-in user may change only their own name and avatar (and clear their own must-reset flag) ─────────────────────
-- Every admin change to a profile (role, active, organization, manager, store, department...) already goes through the server's
-- service-role client, so nothing in the application loses a capability. Column privileges are enforced by PostgREST itself.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, avatar_url, must_reset_password) ON public.profiles TO authenticated;

-- Belt and braces: even if a wider grant is ever re-added, a client role cannot change who a row belongs to, its role, or its
-- active flag, and can only clear (never set) the must-reset flag. The server (service_role) and direct admin sessions are unaffected.
CREATE OR REPLACE FUNCTION public.guard_profile_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
       OR NEW.store_id IS DISTINCT FROM OLD.store_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
       OR NEW.function_id IS DISTINCT FROM OLD.function_id
       OR NEW.designation_id IS DISTINCT FROM OLD.designation_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.job_title IS DISTINCT FROM OLD.job_title
       OR NEW.whatsapp_enabled IS DISTINCT FROM OLD.whatsapp_enabled
       OR (NEW.must_reset_password IS DISTINCT FROM OLD.must_reset_password AND NEW.must_reset_password IS TRUE) THEN
      RAISE EXCEPTION 'these profile fields can only be changed by an administrator' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_profile_client_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_client_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_client_update();
