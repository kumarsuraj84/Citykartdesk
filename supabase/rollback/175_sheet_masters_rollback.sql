-- Rollback of 20240101000175_sheet_masters.sql: removes the master-data tables and the Vault helpers. Everything in them is a copy of the Google Sheets, which stay as they are.
-- The saved per-ticket copies (request_master_snapshots) are lost; the tickets themselves are not touched.
BEGIN;
DROP TABLE IF EXISTS public.request_master_snapshots;
DROP TABLE IF EXISTS public.master_mail_templates;
DROP TABLE IF EXISTS public.master_issues;
DROP TABLE IF EXISTS public.master_store_cvm;
DROP TABLE IF EXISTS public.master_gensets;
DROP TABLE IF EXISTS public.master_ac_units;
DROP TABLE IF EXISTS public.master_google_connection;
DROP TABLE IF EXISTS public.master_sources;
DELETE FROM vault.secrets WHERE name LIKE 'masters-google-%';
DROP FUNCTION IF EXISTS public.masters_store_credential(uuid, text);
DROP FUNCTION IF EXISTS public.masters_read_credential(uuid);
DELETE FROM auth.schema_migrations WHERE version = '20240101000175';
COMMIT;
