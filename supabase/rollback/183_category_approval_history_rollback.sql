-- Rollback of 183 (category switch for the approval history box). Only the switch settings are lost; no ticket or approval is touched.
BEGIN;
ALTER TABLE public.service_categories DROP COLUMN IF EXISTS show_approval_history;
DELETE FROM auth.schema_migrations WHERE version = '20240101000183';
COMMIT;
