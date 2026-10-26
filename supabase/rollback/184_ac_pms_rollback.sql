-- Rollback of 184 (AC PMS). Tickets already made stay as they are (they are ordinary tickets); only the PMS sheet copy, the log and the category switch are lost.
BEGIN;
DELETE FROM public.master_issues WHERE kind = 'pms';
DELETE FROM public.master_sources WHERE kind = 'pms';
DROP TABLE IF EXISTS public.pms_ticket_log;
DROP TABLE IF EXISTS public.master_pms_dates;
ALTER TABLE public.service_categories DROP COLUMN IF EXISTS is_pms;
ALTER TABLE public.master_sources DROP CONSTRAINT IF EXISTS master_sources_kind_check;
ALTER TABLE public.master_sources ADD CONSTRAINT master_sources_kind_check CHECK (kind = ANY (ARRAY['ac'::text, 'genset'::text, 'cvm'::text]));
ALTER TABLE public.master_issues DROP CONSTRAINT IF EXISTS master_issues_kind_check;
ALTER TABLE public.master_issues ADD CONSTRAINT master_issues_kind_check CHECK (kind = ANY (ARRAY['ac'::text, 'genset'::text, 'cvm'::text]));
COMMIT;
