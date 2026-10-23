-- Rollback of 180. Only safe when no request is waiting (revision_requested / superseded / withdrawn rows are folded back first).
BEGIN;
UPDATE public.vendor_requests SET status = 'cancelled' WHERE status IN ('revision_requested', 'superseded', 'withdrawn');
DROP INDEX IF EXISTS public.uq_vendor_requests_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_requests_one_pending ON public.vendor_requests (request_id) WHERE status = 'pending';
ALTER TABLE public.vendor_requests DROP CONSTRAINT IF EXISTS vendor_requests_status_check;
ALTER TABLE public.vendor_requests ADD CONSTRAINT vendor_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'received', 'cancelled'));
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS revision_requested_at;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS revision_requested_by;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS revision_note;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS quote_attachment_ids;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS replaces_id;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS version;
COMMIT;
