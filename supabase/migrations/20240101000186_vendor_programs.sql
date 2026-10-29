-- 186: Vendor Programs (one settings record per service line: AC-like, Genset-like, RO purifier ...). LOCAL ONLY until released. Safe to run twice.
-- Rollback: supabase/rollback/186_vendor_programs_rollback.sql
--
-- A program = the categories it covers, one Google sheet (copied here three times a day like the AC / Genset sheets), the mail sent to the vendor / OEM at the start and
-- what happens to the ticket afterwards. Design: docs/VENDOR-PROGRAMS-DESIGN.md. Nothing here changes an existing row: AC and Genset keep their own tables and code;
-- a program is created by an administrator (none exists after this migration). Every new table is read and written by the server only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_programs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  slug             text NOT NULL,
  is_active        boolean NOT NULL DEFAULT false,
  level            text NOT NULL DEFAULT 'mail' CHECK (level IN ('mail', 'portal')),
  row_type         text NOT NULL DEFAULT 'store' CHECK (row_type IN ('store', 'machine')),
  spreadsheet_id   text,
  tab_name         text,
  columns          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the heading names an administrator typed for a field (store, mail, vendor ...); empty = the defaults
  mail_subject     text,
  mail_body_html   text,
  last_checked_at  timestamptz,
  last_applied_at  timestamptz,
  last_status      text CHECK (last_status IN ('ok', 'error')),
  last_error       text,
  row_count        integer,
  content_hash     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (org_id, slug)
);

-- One row per sheet row. A row that leaves the sheet is kept (removed_at) so the history of its tickets stays readable.
CREATE TABLE IF NOT EXISTS public.program_rows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id       uuid NOT NULL REFERENCES public.vendor_programs(id) ON DELETE CASCADE,
  store_code       text NOT NULL,
  machine_no       text,
  serial           text,
  vendor           text,
  emails           text[] NOT NULL DEFAULT '{}',
  po_emails        text[] NOT NULL DEFAULT '{}',
  approver_emails  text[] NOT NULL DEFAULT '{}',
  extra            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- every other column of the sheet, by its heading
  is_active        boolean NOT NULL DEFAULT true,
  sheet_row        integer,
  previous_serials text[] NOT NULL DEFAULT '{}',
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  missing_since    timestamptz,
  removed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_program_rows_store ON public.program_rows (program_id, store_code) WHERE removed_at IS NULL;

-- Problems found in a program's sheet, shown on its screen. Replaced as a whole at every applied check.
CREATE TABLE IF NOT EXISTS public.program_issues (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id  uuid NOT NULL REFERENCES public.vendor_programs(id) ON DELETE CASCADE,
  severity    text NOT NULL CHECK (severity IN ('error', 'warning')),
  code        text NOT NULL,
  store_code  text,
  sheet_row   integer,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_program_issues_program ON public.program_issues (program_id);

-- What a ticket was mailed for (the rows' details at that moment), so an old ticket stays readable whatever happens in the sheet later.
CREATE TABLE IF NOT EXISTS public.request_program_snapshots (
  request_id  uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  program_id  uuid NOT NULL REFERENCES public.vendor_programs(id) ON DELETE RESTRICT,
  row_ids     uuid[] NOT NULL DEFAULT '{}',
  snapshot    jsonb NOT NULL,
  mailed_to   text[] NOT NULL DEFAULT '{}',
  mailed_cc   text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, program_id)
);

-- Which program a category belongs to. A category is in at most one program, and not in a program AND an AC / Genset OEM type or the AC PMS category at the same time.
ALTER TABLE public.service_categories ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.vendor_programs(id) ON DELETE SET NULL;
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_program_exclusive_check;
ALTER TABLE public.service_categories ADD CONSTRAINT service_categories_program_exclusive_check
  CHECK (program_id IS NULL OR (auto_oem_kind IS NULL AND is_pms = false));
CREATE INDEX IF NOT EXISTS idx_service_categories_program ON public.service_categories (program_id) WHERE program_id IS NOT NULL;

-- Server only: row security on, no right for the public, signed-in users or anonymous visitors.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vendor_programs', 'program_rows', 'program_issues', 'request_program_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.program_issues_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.program_issues_id_seq TO service_role;

COMMIT;
