-- Rollback of 190 (the one new table; run it only after the app of this release has been rolled back).
BEGIN;
DROP TABLE IF EXISTS public.request_automation_state;
DELETE FROM auth.schema_migrations WHERE version = '20240101000190';
COMMIT;
