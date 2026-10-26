-- 183: per category switch "show earlier requests of the same store and sub-category in the approval mail". LOCAL ONLY until released.
-- Rollback: supabase/rollback/183_category_approval_history_rollback.sql
--
-- The approver's mail (and the approve page) then carries a small box: what this store is asking now, and the last decisions on requests of the same store and
-- the same sub-category. Which form answers appear in the box (for example Qty) is chosen per field in the form builder ("Show in approval history"); that setting
-- lives inside the form itself, so it needs no column.
-- Categories that already send their tickets to the store's CVM automatically start with the switch ON; every other category starts OFF.
BEGIN;

ALTER TABLE public.service_categories ADD COLUMN IF NOT EXISTS show_approval_history boolean NOT NULL DEFAULT false;
UPDATE public.service_categories SET show_approval_history = true WHERE auto_cvm_approval = true;

COMMIT;
