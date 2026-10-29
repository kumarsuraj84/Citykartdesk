-- Rollback of 186 (Vendor Programs). Run only if no ticket has been mailed through a program yet (request_program_snapshots would be dropped with its history).
BEGIN;
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_program_exclusive_check;
DROP INDEX IF EXISTS public.idx_service_categories_program;
ALTER TABLE public.service_categories DROP COLUMN IF EXISTS program_id;
DROP TABLE IF EXISTS public.request_program_snapshots;
DROP TABLE IF EXISTS public.program_issues;
DROP TABLE IF EXISTS public.program_rows;
DROP TABLE IF EXISTS public.vendor_programs;
COMMIT;
