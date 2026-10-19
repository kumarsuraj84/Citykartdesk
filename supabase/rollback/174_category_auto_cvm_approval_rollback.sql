-- Rollback of 20240101000174_category_auto_cvm_approval.sql (the setting of the categories made after the migration is lost).
BEGIN;
ALTER TABLE public.service_categories DROP COLUMN IF EXISTS auto_cvm_approval;
COMMIT;
