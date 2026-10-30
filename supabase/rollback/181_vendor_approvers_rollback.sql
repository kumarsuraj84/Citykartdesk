-- Rollback of 181. The first approver of each request stays in approver_id (it was always kept).
BEGIN;
UPDATE public.vendor_requests SET approver_id = approver_ids[1] WHERE approver_id IS NULL AND array_length(approver_ids, 1) > 0;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS approver_ids;
ALTER TABLE public.master_ac_units DROP COLUMN IF EXISTS approver_emails;
DELETE FROM auth.schema_migrations WHERE version = '20240101000181';
COMMIT;
