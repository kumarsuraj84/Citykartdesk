-- 175: master data read from Google Sheets (AC units, Genset units, store -> CVM). LOCAL ONLY until released. Safe to run twice.
-- Rollback: supabase/rollback/175_sheet_masters_rollback.sql
--
-- The sheets stay the master; the application copies them into these tables every minute (read only, it never writes to a sheet). Every table is written
-- and read by the server only (the screens that show them check the administrator role first), so no right is given to signed-in users or to the public.
-- Nothing here changes an existing table and no row is created: an unreleased feature that is switched on by connecting the Google account.
BEGIN;

-- Which sheet is which, and how the last check went.
CREATE TABLE IF NOT EXISTS public.master_sources (
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('ac', 'genset', 'cvm')),
  spreadsheet_id  text NOT NULL,
  tab_name        text,
  last_checked_at timestamptz,
  last_applied_at timestamptz,
  last_status     text CHECK (last_status IN ('ok', 'error')),
  last_error      text,
  row_count       integer,
  content_hash    text,
  PRIMARY KEY (org_id, kind)
);

-- The Google account the application reads the sheets with (view only). The refresh token itself lives in the Vault, never in this table.
CREATE TABLE IF NOT EXISTS public.master_google_connection (
  org_id        uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_email text,
  secret_ref    uuid,
  status        text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'broken')),
  last_error    text,
  connected_at  timestamptz NOT NULL DEFAULT now(),
  connected_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One row per AC unit of the AC sheet. A unit that leaves the sheet is kept (removed_at) so the history of its tickets stays readable.
CREATE TABLE IF NOT EXISTS public.master_ac_units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_code      text NOT NULL,
  ckdesk_no       text NOT NULL,
  serial          text,
  floor           text,
  ac_type         text,
  tonnage         text,
  brand           text,
  amc_vendor      text,
  amc_brand       text,
  zenatix         text,
  store_priority  text,
  festival        text,
  region          text,
  cluster         text,
  opening_date    date,
  city            text,
  state           text,
  address         text,
  pincode         text,
  is_active       boolean NOT NULL DEFAULT true,
  emails          text[] NOT NULL DEFAULT '{}',
  sheet_row       integer,
  previous_serials text[] NOT NULL DEFAULT '{}',
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  missing_since   timestamptz,
  removed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_master_ac_units_store ON public.master_ac_units (org_id, store_code) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.master_gensets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_code      text NOT NULL,
  brand           text,
  kva             text,
  serial          text,
  cpcb_group      text,
  emails          text[] NOT NULL DEFAULT '{}',
  sheet_row       integer,
  previous_serials text[] NOT NULL DEFAULT '{}',
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  missing_since   timestamptz,
  removed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_master_gensets_store ON public.master_gensets (org_id, store_code) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.master_store_cvm (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_code    text NOT NULL,
  cvm_email     text NOT NULL,
  sheet_row     integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  missing_since timestamptz,
  removed_at    timestamptz,
  UNIQUE (org_id, store_code)
);

-- Problems found in the sheets, shown on the "Master data health" page. Replaced as a whole at every applied check.
CREATE TABLE IF NOT EXISTS public.master_issues (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('ac', 'genset', 'cvm')),
  severity    text NOT NULL CHECK (severity IN ('error', 'warning')),
  code        text NOT NULL,
  store_code  text,
  sheet_row   integer,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_master_issues_org ON public.master_issues (org_id, kind);

-- The one AC mail template and the one Genset mail template.
CREATE TABLE IF NOT EXISTS public.master_mail_templates (
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('ac', 'genset')),
  subject    text NOT NULL,
  body_html  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, kind)
);

-- What a ticket was raised for (the unit's details at that moment), so old tickets stay readable whatever happens in the sheet later.
CREATE TABLE IF NOT EXISTS public.request_master_snapshots (
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('ac', 'genset')),
  unit_ids   uuid[] NOT NULL DEFAULT '{}',
  snapshot   jsonb NOT NULL,
  mailed_to  text[] NOT NULL DEFAULT '{}',
  mailed_cc  text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, kind)
);

-- Server only: row security on, no right for the public, signed-in users or anonymous visitors.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['master_sources', 'master_google_connection', 'master_ac_units', 'master_gensets', 'master_store_cvm', 'master_issues', 'master_mail_templates', 'request_master_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.master_issues_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.master_issues_id_seq TO service_role;

-- The Google refresh token is kept in the Vault, like the mailbox credentials.
CREATE OR REPLACE FUNCTION public.masters_store_credential(p_org uuid, p_secret text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault' AS $function$
DECLARE v_name text := 'masters-google-' || p_org::text; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, p_secret, v_name, 'Google Sheets master data');
  ELSE
    v_id := vault.create_secret(p_secret, v_name, 'Google Sheets master data');
  END IF;
  RETURN v_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.masters_read_credential(p_ref uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'vault' AS $function$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = p_ref
$function$;
REVOKE ALL ON FUNCTION public.masters_store_credential(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.masters_read_credential(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.masters_store_credential(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.masters_read_credential(uuid) TO service_role;

COMMIT;
