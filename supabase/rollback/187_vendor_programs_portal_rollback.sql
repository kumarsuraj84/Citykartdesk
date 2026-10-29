-- Rollback of 187 (only the two added columns; run it only after the app of this release has been rolled back).
BEGIN;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS default_approver_ids;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS oem_number_required;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS resolution_options;
DELETE FROM auth.schema_migrations WHERE version = '20240101000187';
COMMIT;
