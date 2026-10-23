-- 181: PO approvers come from the AC sheet (column "CK PO Approver Mail To"), one or several per AC. LOCAL ONLY until released (goes out with the vendor PO release).
-- Rollback: supabase/rollback/181_vendor_approvers_rollback.sql
--
--  * master_ac_units.approver_emails: the Citykart addresses that approve a vendor's quote for that AC (empty = the default approver set in Admin > Vendors);
--  * vendor_requests.approver_ids: every approver the quote was sent to; any one of them may decide (the first decision wins).
BEGIN;

ALTER TABLE public.master_ac_units ADD COLUMN IF NOT EXISTS approver_emails text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS approver_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE public.vendor_requests SET approver_ids = ARRAY[approver_id] WHERE approver_id IS NOT NULL AND approver_ids = '{}';

COMMIT;
