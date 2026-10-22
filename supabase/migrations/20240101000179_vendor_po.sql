-- 179: purchase orders asked by a vendor ("PO required from Citykart"). LOCAL ONLY until released ("push vendor PO one").
-- Rollback: supabase/rollback/179_vendor_po_rollback.sql
--
--  * vendor_requests gets the approval details of a PO: who must approve it, the PO number, the PO date and the PO document (kept as a file on the ticket);
--  * the AC master gets the OEM's address for PO details (the AC sheet column "Email for PO detail");
--  * a ticket on hold may now be CANCELLED by the system (the PO was rejected, exactly like a rejected approval cancels a ticket today).
-- Nothing else about statuses changes.
BEGIN;

ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS approver_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS po_number         text;
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS po_date           date;
ALTER TABLE public.vendor_requests ADD COLUMN IF NOT EXISTS po_attachment_id  uuid REFERENCES public.request_attachments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_requests_po_number ON public.vendor_requests (org_id, po_number) WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_requests_approver ON public.vendor_requests (approver_id) WHERE status = 'pending';

ALTER TABLE public.master_ac_units ADD COLUMN IF NOT EXISTS po_emails text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.request_status_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  SELECT p_from = p_to OR (p_from, p_to) IN (
    ('open', 'assigned'), ('open', 'in_progress'), ('open', 'cancelled'),
    ('assigned', 'open'), ('assigned', 'in_progress'), ('assigned', 'cancelled'),
    ('in_progress', 'waiting_user'), ('in_progress', 'hold_purchase_ho'), ('in_progress', 'resolved'), ('in_progress', 'cancelled'),
    ('waiting_user', 'in_progress'), ('waiting_user', 'resolved'), ('waiting_user', 'open'), ('waiting_user', 'cancelled'),
    ('hold_purchase_ho', 'in_progress'), ('hold_purchase_ho', 'cancelled'),
    ('resolved', 'open')
  )
$function$;

COMMIT;
