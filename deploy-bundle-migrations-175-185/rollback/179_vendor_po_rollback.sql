-- Rollback of 179 (vendor PO). Run only when no PO request exists (or accept losing the PO details).
BEGIN;
CREATE OR REPLACE FUNCTION public.request_status_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  SELECT p_from = p_to OR (p_from, p_to) IN (
    ('open', 'assigned'), ('open', 'in_progress'), ('open', 'cancelled'),
    ('assigned', 'open'), ('assigned', 'in_progress'), ('assigned', 'cancelled'),
    ('in_progress', 'waiting_user'), ('in_progress', 'hold_purchase_ho'), ('in_progress', 'resolved'), ('in_progress', 'cancelled'),
    ('waiting_user', 'in_progress'), ('waiting_user', 'resolved'), ('waiting_user', 'open'), ('waiting_user', 'cancelled'),
    ('hold_purchase_ho', 'in_progress'),
    ('resolved', 'open')
  )
$function$;
ALTER TABLE public.master_ac_units DROP COLUMN IF EXISTS po_emails;
DROP INDEX IF EXISTS public.idx_vendor_requests_approver;
DROP INDEX IF EXISTS public.idx_vendor_requests_po_number;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS po_attachment_id;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS po_date;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS po_number;
ALTER TABLE public.vendor_requests DROP COLUMN IF EXISTS approver_id;
COMMIT;
