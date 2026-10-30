BEGIN;
-- ROLLBACK for migration 161 (approval e-mail codes). Drops the table; codes already issued simply stop working (the approver can ask for a new one
-- once the previous build is back in place). LOCAL; NOT run on production.
DROP TABLE IF EXISTS public.approval_email_codes;
NOTIFY pgrst, 'reload schema';
DELETE FROM auth.schema_migrations WHERE version = '20240101000161';
COMMIT;
