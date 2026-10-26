-- 184: AC PMS (preventive maintenance) - a fourth master sheet with the PMS date of each store, tickets made from it at 09:00, and a vendor tab for them. LOCAL ONLY until released.
-- Rollback: supabase/rollback/184_ac_pms_rollback.sql
--
--  - master_sources / master_issues accept the new sheet kind 'pms';
--  - master_pms_dates: the copy of the sheet (one row per store and PMS date). Server only;
--  - pms_ticket_log: one row per store and PMS date saying which ticket was made (or why not), so a date can never make two tickets. Server only;
--  - service_categories.is_pms: "tickets of this category are the AC PMS tickets" - they are made from the sheet and the vendors see them in their own "AC PMS tickets" tab.
BEGIN;

ALTER TABLE public.master_sources DROP CONSTRAINT IF EXISTS master_sources_kind_check;
ALTER TABLE public.master_sources ADD CONSTRAINT master_sources_kind_check CHECK (kind = ANY (ARRAY['ac'::text, 'genset'::text, 'cvm'::text, 'pms'::text]));
ALTER TABLE public.master_issues DROP CONSTRAINT IF EXISTS master_issues_kind_check;
ALTER TABLE public.master_issues ADD CONSTRAINT master_issues_kind_check CHECK (kind = ANY (ARRAY['ac'::text, 'genset'::text, 'cvm'::text, 'pms'::text]));

CREATE TABLE IF NOT EXISTS public.master_pms_dates (
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_code    text NOT NULL,
  pms_date      date NOT NULL,
  sheet_row     integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, store_code, pms_date)
);
CREATE INDEX IF NOT EXISTS idx_master_pms_dates_day ON public.master_pms_dates (org_id, pms_date);

CREATE TABLE IF NOT EXISTS public.pms_ticket_log (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_code  text NOT NULL,
  pms_date    date NOT NULL,
  status      text NOT NULL CHECK (status IN ('creating', 'created', 'skipped', 'failed')),
  request_id  uuid REFERENCES public.requests(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, store_code, pms_date)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['master_pms_dates', 'pms_ticket_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

ALTER TABLE public.service_categories ADD COLUMN IF NOT EXISTS is_pms boolean NOT NULL DEFAULT false;

COMMIT;
