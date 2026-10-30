-- Rollback of 20240101000165_server_only_writes.sql: puts back the table, sequence and default privileges EXACTLY as recorded when the migration ran
-- (row security policies still apply as before). Run it BEFORE the rollback of 164 (reverse order).
BEGIN;
-- Put back the privileges recorded by the migration (only for the objects that existed then).
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public._grant_snapshots') IS NULL THEN
    RAISE EXCEPTION 'The grant record of migration 165 (public._grant_snapshots) is missing: this rollback cannot restore the previous privileges exactly.';
  END IF;
  FOR r IN SELECT DISTINCT kind, object_name FROM public._grant_snapshots WHERE stage = '165' AND kind IN ('table', 'sequence') LOOP
    IF to_regclass('public.' || quote_ident(r.object_name)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON %s public.%I FROM anon, authenticated', CASE r.kind WHEN 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, r.object_name);
    END IF;
  END LOOP;
  FOR r IN SELECT kind, grantee, object_name, privilege FROM public._grant_snapshots WHERE stage = '165' AND kind IN ('table', 'sequence') AND privilege <> '-' LOOP
    IF to_regclass('public.' || quote_ident(r.object_name)) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON %s public.%I TO %I', r.privilege, CASE r.kind WHEN 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, r.object_name, r.grantee);
    END IF;
  END LOOP;
  FOR r IN SELECT grantee, object_name, privilege FROM public._grant_snapshots WHERE stage = '165' AND kind = 'column' LOOP
    IF to_regclass('public.' || quote_ident(split_part(r.object_name, '.', 1))) IS NOT NULL THEN
      EXECUTE format('GRANT %s (%I) ON TABLE public.%I TO %I', r.privilege, split_part(r.object_name, '.', 2), split_part(r.object_name, '.', 1), r.grantee);
    END IF;
  END LOOP;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  FOR r IN SELECT kind, grantee, privilege FROM public._grant_snapshots WHERE stage = '165' AND kind IN ('default_r', 'default_S') LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT %s ON %s TO %I', r.privilege, CASE r.kind WHEN 'default_S' THEN 'SEQUENCES' ELSE 'TABLES' END, r.grantee);
  END LOOP;
  DELETE FROM public._grant_snapshots WHERE stage = '165';
  IF NOT EXISTS (SELECT 1 FROM public._grant_snapshots) THEN DROP TABLE public._grant_snapshots; END IF;
END $$;
DELETE FROM auth.schema_migrations WHERE version = '20240101000165';
COMMIT;
