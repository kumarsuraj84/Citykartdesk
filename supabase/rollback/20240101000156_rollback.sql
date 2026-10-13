-- ROLLBACK for migration 156 (Critical database fixes D-002, D-003, D-007). LOCAL; NOT run on production.
--
-- WARNING: this puts back the original behaviour, which IS the vulnerability: any signed-in or anonymous API user can call owner_delete_org()
-- (deletes a whole organization) and rewrite their own profile (organization, role, active flag). Use it only to undo a broken deployment,
-- and re-apply migration 156 as soon as the cause is fixed. After running it on a database behind PostgREST, restart the REST service.

-- D-003: the previous table-level update right, and no trigger guard
DROP TRIGGER IF EXISTS trg_guard_profile_client_update ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_client_update();
GRANT UPDATE ON public.profiles TO authenticated;

-- D-007: helpers callable by everyone again; the ticket-number trigger runs as the inserting user again
GRANT EXECUTE ON FUNCTION public.trg_assign_request_no() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_seed_org_sla_config() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_sla_config(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_request_no() TO PUBLIC;
CREATE OR REPLACE FUNCTION public.trg_assign_request_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.request_no := generate_request_no();
  RETURN NEW;
END;
$function$;

-- D-002: the function without its caller check, executable by everyone
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
GRANT EXECUTE ON FUNCTION public.owner_delete_org(uuid) TO PUBLIC;
