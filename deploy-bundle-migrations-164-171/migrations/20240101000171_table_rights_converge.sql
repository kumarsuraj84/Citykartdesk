-- Remediation phase 6 (LOCAL; apply after 170). Rollback: supabase/rollback/171_table_rights_converge_rollback.sql
-- Found by comparing a read-only snapshot of the LIVE database (2026-10-17) with the rehearsal baseline: every table, function and row-security policy is the same, but on live
-- the signed-in role (authenticated) holds FULL rights (insert / update / delete / truncate ...) on 26 tables where the rehearsal database never had them, so migration 165
-- (which locks down a named list of tables) left those 26 writable by any signed-in user, limited only by row security. This migration trims those extra WRITE rights to what
-- the application actually needs; reading (SELECT) is never touched, row security is unchanged. Four tables keep the write that the application still performs with the
-- user's own login (the same write that works today): error_reports INSERT, intake_messages UPDATE, intake_notes INSERT + DELETE, notification_preferences INSERT + UPDATE + DELETE.
-- Three functions that only the server calls (with its own key) lose EXECUTE for signed-in users.
-- The exact previous rights are recorded first (public._grant_snapshots, stage 171) so the rollback restores them.

BEGIN;

CREATE TABLE IF NOT EXISTS public._grant_snapshots (
  stage text NOT NULL, kind text NOT NULL, grantee text NOT NULL, object_name text NOT NULL, privilege text NOT NULL,
  PRIMARY KEY (stage, kind, grantee, object_name, privilege)
);
ALTER TABLE public._grant_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._grant_snapshots FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
  p text;
  v_function_names text[] := ARRAY['commit_conversation_transition', 'merge_request_form_data', 'replace_email_in_list'];
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('conversation_attachments', ARRAY[]::text[]),
    ('conversation_events', ARRAY[]::text[]),
    ('csat_surveys', ARRAY['UPDATE']::text[]),
    ('error_reports', ARRAY['INSERT']::text[]),
    ('escalation_policies', ARRAY[]::text[]),
    ('intake_attachments', ARRAY[]::text[]),
    ('intake_classifications', ARRAY[]::text[]),
    ('intake_messages', ARRAY['UPDATE']::text[]),
    ('intake_notes', ARRAY['INSERT', 'DELETE']::text[]),
    ('intake_outbound', ARRAY[]::text[]),
    ('intake_pipeline_config', ARRAY['INSERT', 'UPDATE']::text[]),
    ('intake_reviews', ARRAY['UPDATE']::text[]),
    ('intake_threads', ARRAY[]::text[]),
    ('kb_article_services', ARRAY[]::text[]),
    ('kb_articles', ARRAY['INSERT', 'UPDATE']::text[]),
    ('license_keys', ARRAY[]::text[]),
    ('notification_preferences', ARRAY['INSERT', 'UPDATE', 'DELETE']::text[]),
    ('org_module_access', ARRAY[]::text[]),
    ('org_signup_requests', ARRAY[]::text[]),
    ('organizations', ARRAY[]::text[]),
    ('project_members', ARRAY['INSERT', 'DELETE']::text[]),
    ('project_updates', ARRAY['INSERT', 'DELETE']::text[]),
    ('projects', ARRAY['INSERT', 'UPDATE']::text[]),
    ('related_requests', ARRAY['INSERT', 'DELETE']::text[]),
    ('request_collaborators', ARRAY['INSERT', 'DELETE']::text[]),
    ('task_dependencies', ARRAY['INSERT', 'DELETE']::text[])
  ) AS v(tbl, keep) LOOP
    IF to_regclass('public.' || quote_ident(r.tbl)) IS NULL THEN CONTINUE; END IF;
    -- record what the signed-in role holds on the table now (a marker row for tables where it holds nothing)
    INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege) VALUES ('171', 'table', 'authenticated', r.tbl, '-') ON CONFLICT DO NOTHING;
    INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege)
      SELECT '171', 'table', 'authenticated', c.relname, a.privilege_type
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles ro ON ro.oid = a.grantee
      WHERE c.oid = to_regclass('public.' || quote_ident(r.tbl)) AND ro.rolname = 'authenticated'
      ON CONFLICT DO NOTHING;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', r.tbl);
    FOREACH p IN ARRAY r.keep LOOP
      EXECUTE format('GRANT %s ON TABLE public.%I TO authenticated', p, r.tbl);
    END LOOP;
  END LOOP;

  FOR r IN SELECT p.oid, p.oid::regprocedure::text AS sig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_function_names) LOOP
    INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege) VALUES ('171', 'function', 'authenticated', r.sig, '-') ON CONFLICT DO NOTHING;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      INSERT INTO public._grant_snapshots (stage, kind, grantee, object_name, privilege) VALUES ('171', 'function', 'authenticated', r.sig, 'EXECUTE') ON CONFLICT DO NOTHING;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, authenticated', r.sig);
  END LOOP;
END $$;

COMMIT;
