-- ── Fix missing service_role DML grants on tables created after migration 0 ────
--
-- migration 20240101000000_initial_schema.sql ends with:
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
-- That statement only applies to tables that existed AT THAT MOMENT — it is not an
-- `ALTER DEFAULT PRIVILEGES` rule, so every table created by a LATER migration never
-- received service_role grants at all. RLS bypass (service_role's BYPASSRLS) does not
-- substitute for a table-level GRANT; Postgres checks GRANTs before RLS is even
-- evaluated, so any server action using createAdminClient() (service-role) against one
-- of these tables fails with "permission denied for table X" — the same class of bug
-- fixed for `services`/`service_categories` in migration 090, just via the service_role
-- path instead of authenticated.
--
-- Concretely this was silently breaking:
--   - admin_audit_log inserts (logAdminAudit() is try/catch-wrapped as "best effort",
--     so every admin action this session — service/category create/update/delete,
--     duplicate, form save — logged nothing, with no visible error)
--   - field_sla_overrides inserts (the Field SLA Matrix just added)
--   - task_attachments, notification_preferences, org_signup_requests, custom_roles,
--     permission_overrides, error_reports, and the entire intake_* module, all of
--     which are written via the admin client elsewhere in the app
--
-- Found by auditing information_schema.role_table_grants for every public table with
-- zero service_role SELECT/INSERT/UPDATE/DELETE grants.

GRANT SELECT, INSERT, UPDATE, DELETE ON admin_audit_log         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON error_reports            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON field_sla_overrides      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_attachments       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_audit_log         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_channels          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_classifications   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_messages          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_notes             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_outbound          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_pipeline_config   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_reviews           TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_rules             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_threads           TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_signup_requests      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON permission_overrides     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_attachments         TO service_role;

NOTIFY pgrst, 'reload schema';
