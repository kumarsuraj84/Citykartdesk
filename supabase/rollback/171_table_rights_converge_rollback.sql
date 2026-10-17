-- Rollback of 20240101000171_table_rights_converge.sql: puts back the rights of the signed-in role on those tables and functions EXACTLY as recorded. Run it BEFORE the rollback of 170.
BEGIN;
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public._grant_snapshots') IS NULL THEN
    RAISE EXCEPTION 'The grant record of migration 171 (public._grant_snapshots) is missing: this rollback cannot restore the previous privileges exactly.';
  END IF;
  FOR r IN SELECT DISTINCT object_name FROM public._grant_snapshots WHERE stage = '171' AND kind = 'table' LOOP
    IF to_regclass('public.' || quote_ident(r.object_name)) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', r.object_name);
    END IF;
  END LOOP;
  FOR r IN SELECT object_name, privilege FROM public._grant_snapshots WHERE stage = '171' AND kind = 'table' AND privilege <> '-' LOOP
    IF to_regclass('public.' || quote_ident(r.object_name)) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO authenticated', r.privilege, r.object_name);
    END IF;
  END LOOP;
  FOR r IN SELECT object_name FROM public._grant_snapshots WHERE stage = '171' AND kind = 'function' AND privilege = 'EXECUTE' LOOP
    IF to_regprocedure(r.object_name) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.object_name);
    END IF;
  END LOOP;
  DELETE FROM public._grant_snapshots WHERE stage = '171';
  IF NOT EXISTS (SELECT 1 FROM public._grant_snapshots) THEN DROP TABLE public._grant_snapshots; END IF;
END $$;
COMMIT;
