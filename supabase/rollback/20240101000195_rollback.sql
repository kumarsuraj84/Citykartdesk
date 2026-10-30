-- Rollback of 195 (the Intake inbox view). The inbox page must be on the code from before this change when this is run.
BEGIN;
DROP VIEW IF EXISTS public.intake_inbox_v;
NOTIFY pgrst, 'reload schema';
DELETE FROM auth.schema_migrations WHERE version = '20240101000195';
COMMIT;
