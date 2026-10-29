-- 191: Vendor Programs - PMS (preventive maintenance) tickets per program (additive only: new columns on vendor_programs and two new tables, nothing existing changes).
--  - vendor_programs.pms_*: the program's own PMS Google Sheet (two columns: Store Code and PMS Date, one row per store and date), exactly like today's AC PMS sheet but one per program.
--  - program_pms_dates: the copy of that sheet (the server never writes to a sheet).
--  - program_pms_log: one row per program, store and PMS date, so a date never makes two tickets (even if two runs overlap), and a date that could not be made says why.
-- The tickets are made like the AC PMS tickets (from 09:00 India time on the PMS date, one ticket per store, raised from the store's own login) in the program's PMS category
-- (a category of the program that is ticked "AC PMS category"), and mailed to the program's vendor with all the store's machines.
BEGIN;

ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS pms_spreadsheet_id text;
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS pms_tab_name text;
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS pms_content_hash text;
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS pms_last_checked_at timestamptz;
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS pms_last_status text CHECK (pms_last_status IN ('ok', 'error'));
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS pms_last_error text;
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS pms_row_count integer;

CREATE TABLE IF NOT EXISTS public.program_pms_dates (
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id    uuid NOT NULL REFERENCES public.vendor_programs(id) ON DELETE CASCADE,
  store_code    text NOT NULL,
  pms_date      date NOT NULL,
  sheet_row     integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, store_code, pms_date)
);
CREATE INDEX IF NOT EXISTS idx_program_pms_dates_due ON public.program_pms_dates (org_id, pms_date);

CREATE TABLE IF NOT EXISTS public.program_pms_log (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id  uuid NOT NULL REFERENCES public.vendor_programs(id) ON DELETE CASCADE,
  store_code  text NOT NULL,
  pms_date    date NOT NULL,
  status      text NOT NULL CHECK (status IN ('creating', 'created', 'skipped', 'failed')),
  request_id  uuid REFERENCES public.requests(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, store_code, pms_date)
);

ALTER TABLE public.program_pms_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_pms_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.program_pms_dates TO service_role;   -- the server's key only (no grant, no policy for signed-in users)
GRANT ALL ON public.program_pms_log TO service_role;

-- A category of a program may now ALSO be ticked "AC PMS category": that is the program's PMS category. It still cannot also send to the old AC / Genset OEM.
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_program_exclusive_check;
ALTER TABLE public.service_categories ADD CONSTRAINT service_categories_program_exclusive_check
  CHECK (program_id IS NULL OR auto_oem_kind IS NULL);

COMMIT;
