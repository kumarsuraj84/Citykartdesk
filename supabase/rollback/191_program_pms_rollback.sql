-- Rollback of 191 (run it only after the app of this release has been rolled back). Tickets already made stay: they are ordinary tickets.
BEGIN;
-- the old rule (a category of a program cannot be a PMS category): first take any PMS category out of its program
UPDATE public.service_categories SET program_id = NULL WHERE program_id IS NOT NULL AND is_pms = true;
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_program_exclusive_check;
ALTER TABLE public.service_categories ADD CONSTRAINT service_categories_program_exclusive_check
  CHECK (program_id IS NULL OR (auto_oem_kind IS NULL AND is_pms = false));
DROP TABLE IF EXISTS public.program_pms_log;
DROP TABLE IF EXISTS public.program_pms_dates;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS pms_row_count;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS pms_last_error;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS pms_last_status;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS pms_last_checked_at;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS pms_content_hash;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS pms_tab_name;
ALTER TABLE public.vendor_programs DROP COLUMN IF EXISTS pms_spreadsheet_id;
DELETE FROM auth.schema_migrations WHERE version = '20240101000191';
COMMIT;
