-- Rollback of 188 (the one added column; run it only after the app of this release has been rolled back).
BEGIN;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS details_template;
DELETE FROM auth.schema_migrations WHERE version = '20240101000188';
COMMIT;
