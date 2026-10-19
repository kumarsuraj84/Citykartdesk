-- Category auto-approval by the store's CVM (LOCAL; separate release, after 164-173). Rollback: supabase/rollback/174_category_auto_cvm_approval_rollback.sql
--
-- A category can say "a ticket raised under this category is put In Process and sent for approval to the CVM of the requester's store automatically"
-- (for example Fixture, Hangers, Fixture Attachments). The ticket then waits in Pending Approval (the clock is paused, like any approval) and returns to
-- In Process by itself when the CVM approves. No existing row changes (default: off). No data is created.
BEGIN;
ALTER TABLE public.service_categories ADD COLUMN IF NOT EXISTS auto_cvm_approval boolean NOT NULL DEFAULT false;
COMMIT;
