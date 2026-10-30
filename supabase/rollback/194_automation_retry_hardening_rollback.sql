-- Rollback of 194 (new columns and indexes only; the grants stay tightened, which is the safe state). Run it only after the app of this release has been rolled back.
BEGIN;
DROP INDEX IF EXISTS public.idx_requests_pms_store_date;
DROP INDEX IF EXISTS public.idx_request_automation_state_retry;
ALTER TABLE public.request_automation_state DROP COLUMN IF EXISTS mail_started_at;
ALTER TABLE public.request_automation_state DROP COLUMN IF EXISTS running_since;
ALTER TABLE public.request_automation_state DROP COLUMN IF EXISTS auto_checked_at;
ALTER TABLE public.request_automation_state DROP COLUMN IF EXISTS settled_at;
ALTER TABLE public.request_automation_state DROP COLUMN IF EXISTS expected_steps;
DELETE FROM auth.schema_migrations WHERE version = '20240101000194';
COMMIT;
