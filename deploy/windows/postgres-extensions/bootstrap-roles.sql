-- CREATE ROLE IF NOT EXISTS is not idempotent enough here: on a Postgres
-- cluster that's shared with other apps (roles are cluster-wide, not
-- per-database), a role named e.g. "service_role" can already exist with
-- different attributes than the ones just after CREATE - guarding the
-- CREATE with IF NOT EXISTS then silently skips setting them, leaving
-- service_role WITHOUT bypassrls forever. That's not hypothetical: it's
-- exactly what happened on the first deployment to a shared cluster - every
-- createAdminClient() write in the app was silently running under normal
-- RLS instead of bypassing it, with no error, until this was found by
-- testing a bulk write and noticing 0 rows were actually updated. Create if
-- missing, then unconditionally ALTER every time so the end state is
-- correct regardless of what existed before.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

ALTER ROLE anon NOLOGIN NOINHERIT;
ALTER ROLE authenticated NOLOGIN NOINHERIT;
ALTER ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

GRANT anon TO citykart_desk_app;
GRANT authenticated TO citykart_desk_app;
GRANT service_role TO citykart_desk_app;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
