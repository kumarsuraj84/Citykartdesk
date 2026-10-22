-- 178: what a vendor asks for while a ticket is on hold ("Part required": items and quantity, no PO). LOCAL ONLY until released ("push vendor parts one").
-- Rollback: supabase/rollback/178_vendor_requests_rollback.sql
--
-- The vendor puts the ticket on "Hold due to Purchase from HO" (no new status): this record says WHAT the hold is for, so the vendor dashboard can tell "Part required"
-- from "PO required from Citykart", and so the lines (item, quantity, and later price) are kept as data, not only as text in the conversation.
-- Server only: row security on, no right for the public, signed-in users or anonymous visitors (the screens check the vendor's access first, through the ticket).
BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id       uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('parts', 'po')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'received', 'cancelled')),
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  decision_reason  text
);
-- a ticket has at most ONE open request at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_requests_one_pending ON public.vendor_requests (request_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_vendor_requests_request ON public.vendor_requests (request_id);

CREATE TABLE IF NOT EXISTS public.vendor_request_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_request_id  uuid NOT NULL REFERENCES public.vendor_requests(id) ON DELETE CASCADE,
  line_no            integer NOT NULL,
  item_name          text NOT NULL CHECK (length(btrim(item_name)) BETWEEN 1 AND 200),
  qty                numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000),
  price_excl_gst     numeric CHECK (price_excl_gst IS NULL OR (price_excl_gst >= 0 AND price_excl_gst <= 1000000000)),
  UNIQUE (vendor_request_id, line_no)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vendor_requests', 'vendor_request_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

COMMIT;
