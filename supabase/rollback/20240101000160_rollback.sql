-- ROLLBACK for migration 160 (system log). Removes the audit triggers, the functions and BOTH tables, including everything recorded in them
-- (the original audit tables were left untouched by the migration, so only rows written to system_log since are lost).
-- LOCAL; NOT run on production. If the log must be kept, export it first (admin screen: System Log -> Export) or copy the tables.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE g.tgname = 'trg_system_log_audit' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_system_log_audit ON public.%I', t.relname);
  END LOOP;
END $$;

-- the append-only guard would refuse the DROP of rows, but dropping the tables does not delete rows one by one
DROP FUNCTION IF EXISTS public.system_log_hash_input(public.system_log);
DROP TABLE IF EXISTS public.system_log_archive;
DROP TABLE IF EXISTS public.system_log;

DROP FUNCTION IF EXISTS public.system_log_audit_trigger();
DROP FUNCTION IF EXISTS public.system_log_clean(jsonb);
DROP FUNCTION IF EXISTS public.system_log_archive_old(integer, integer);
DROP FUNCTION IF EXISTS public.system_log_verify_chain(bigint, integer);
DROP FUNCTION IF EXISTS public.system_log_chain();
DROP FUNCTION IF EXISTS public.system_log_guard();

-- owner_delete_org back to the version from migration 156 (it will delete log rows again only if the tables still exist; they were just dropped)
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
    WHERE table_schema = 'public' AND column_name = 'org_id' AND table_name <> 'organizations'
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
