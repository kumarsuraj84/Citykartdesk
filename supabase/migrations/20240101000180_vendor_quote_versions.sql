-- 180: quote versions for what a vendor asks for (a parts list or a PO quote). LOCAL ONLY until released (goes out with the vendor releases).
-- Rollback: supabase/rollback/180_vendor_quote_versions_rollback.sql
--
-- Negotiating a price changes the QUOTE, not the PO: the PO exists only after the approver approves the final quote. So every change of the list or the price is a new
-- VERSION of the request; the earlier version becomes "superseded" and can no longer be approved. The approver can also ask the vendor for a revised price
-- ("revision_requested": the vendor's turn), and the vendor can withdraw a request. The quote files (compulsory for a PO request) are kept with the version.
BEGIN;

ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS replaces_id uuid REFERENCES public.vendor_requests(id) ON DELETE SET NULL;
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS quote_attachment_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS revision_note text;
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS revision_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS revision_requested_at timestamptz;

ALTER TABLE public.vendor_requests DROP CONSTRAINT IF EXISTS vendor_requests_status_check;
ALTER TABLE public.vendor_requests ADD CONSTRAINT vendor_requests_status_check
  CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected', 'received', 'cancelled', 'superseded', 'withdrawn'));

-- a ticket has at most ONE open request: waiting for the approver (pending) or waiting for the vendor's revised price (revision_requested)
DROP INDEX IF EXISTS public.uq_vendor_requests_one_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_requests_one_open ON public.vendor_requests (request_id) WHERE status IN ('pending', 'revision_requested');

COMMIT;
