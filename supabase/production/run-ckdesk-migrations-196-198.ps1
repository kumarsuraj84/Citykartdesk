# Citykart Desk - live database update: migrations 196, 197, 198 (Zoho -> CK Desk transfer) with a backup first.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   1. takes a full backup of database ckdesk and checks the backup file can be read back
#   2. checks the prerequisites (migration 156 is in place, the tables the new ones point at exist)
#   3. applies the three migrations, each in ONE all-or-nothing transaction. They only ADD (9 new tables, one replaced trigger function); no ticket, user or setting is changed.
#   4. prints a short verification. Re-running is harmless (everything is CREATE IF NOT EXISTS / CREATE OR REPLACE).
# Safe while the app is live: the old app does not touch the new tables. AFTER this script says DONE, tell Claude: the CkDeskPostgrest service on 98 must then be restarted and the app deployed.
# To remove the feature again later: run rollback-196-198.sql (printed at the end) - no ticket is touched.
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-zoho-transfer-$stamp.dump"
$work = Join-Path $env:TEMP "ckdesk-zoho-transfer-$stamp"; New-Item -ItemType Directory -Force $work | Out-Null

$check = @'
-- prerequisites: what the new tables point at, and the number trigger must be the version migration 156 left
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing FROM unnest(ARRAY['organizations','profiles','services','service_categories','service_sub_categories','form_templates','requests','app_settings']) t
   WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'prerequisite tables are missing: %', missing; END IF;
  IF to_regprocedure('public.generate_request_no()') IS NULL THEN RAISE EXCEPTION 'generate_request_no() is missing (migration 156 not applied?)'; END IF;
  IF position('generate_request_no()' in pg_get_functiondef('public.trg_assign_request_no()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'trg_assign_request_no() is not the version of migration 156; stop and tell Claude';
  END IF;
  RAISE NOTICE 'prerequisites OK';
END $$;
'@
$m196 = @'
-- 196: Zoho -> CK Desk transfer, STAGE 1 (mapping + preview only). Additive: new tables only, nothing existing changes, and NO ticket is created by this migration.
-- The owner's basic mapping (Zoho -> CK Desk):
--     Template            -> Form Template zoho_map_templates   (also decides which fields can be mapped)
--     Template + Category -> Service       zoho_map_services    (key: template + category; category '' = the template's default)
--     Sub Category        -> Category      zoho_map_categories  (key: template + category + sub category)
--     Item                -> Sub Category  zoho_map_items       (key: template + category + sub category + item)
--     Requester, Technician -> person      zoho_map_people      (only the people who are not found automatically by e-mail / name)
--     Status              -> Status        zoho_map_values
--   plus zoho_map_fields: which Zoho field fills which field of the CK Desk service's form (extra, per Zoho template).
-- zoho_transfers is the list of Zoho tickets already moved (empty until stage 2). The Zoho database stays read-only, so the "moved" mark lives here.
-- Server key only: no grant and no policy for signed-in users (same pattern as 191). The screens check the administrator role themselves.
BEGIN;

CREATE TABLE IF NOT EXISTS public.zoho_map_templates (
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template     text NOT NULL,
  form_template_id  uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  updated_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_services (
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template  text NOT NULL,
  zoho_category  text NOT NULL DEFAULT '',
  service_id     uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  updated_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_category)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_categories (
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template     text NOT NULL,
  zoho_category     text NOT NULL DEFAULT '',
  zoho_subcategory  text NOT NULL DEFAULT '',
  category_id       uuid NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_category, zoho_subcategory)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_items (
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template     text NOT NULL,
  zoho_category     text NOT NULL DEFAULT '',
  zoho_subcategory  text NOT NULL DEFAULT '',
  zoho_item         text NOT NULL DEFAULT '',
  sub_category_id   uuid NOT NULL REFERENCES public.service_sub_categories(id) ON DELETE CASCADE,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_category, zoho_subcategory, zoho_item)
);

-- A person who could not be matched automatically, matched by hand. zoho_key is the Zoho e-mail in lower case, or the Zoho name in lower case when Zoho has no e-mail.
CREATE TABLE IF NOT EXISTS public.zoho_map_people (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('requester', 'technician')),
  zoho_key    text NOT NULL,
  zoho_name   text,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, zoho_key)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_fields (
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template  text NOT NULL,
  zoho_field     text NOT NULL,
  ck_field_id    text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_field)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_values (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('status')),
  zoho_value  text NOT NULL,
  ck_value    text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, zoho_value)
);

-- One row per Zoho ticket that has been moved. The Zoho ticket number is exactly the number Zoho shows (a whole number), so a ticket can never be moved twice.
CREATE TABLE IF NOT EXISTS public.zoho_transfers (
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_ticket_no   bigint NOT NULL,
  request_id       uuid REFERENCES public.requests(id) ON DELETE SET NULL,
  request_no       text NOT NULL,
  state            text NOT NULL DEFAULT 'moved' CHECK (state IN ('moved', 'withdrawn')),
  moved_at         timestamptz NOT NULL DEFAULT now(),
  moved_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, zoho_ticket_no)
);
CREATE INDEX IF NOT EXISTS idx_zoho_transfers_request ON public.zoho_transfers (request_id);

ALTER TABLE public.zoho_map_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_people     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_fields     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_transfers      ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.zoho_map_templates  TO service_role;
GRANT ALL ON public.zoho_map_services   TO service_role;
GRANT ALL ON public.zoho_map_categories TO service_role;
GRANT ALL ON public.zoho_map_items      TO service_role;
GRANT ALL ON public.zoho_map_people     TO service_role;
GRANT ALL ON public.zoho_map_fields     TO service_role;
GRANT ALL ON public.zoho_map_values     TO service_role;
GRANT ALL ON public.zoho_transfers      TO service_role;

COMMIT;
'@
$m197 = @'
-- 197: a ticket moved from Zoho keeps its Zoho number as `ZOHO-<the Zoho ticket number>` (stage 2 of the Zoho -> CK Desk transfer).
-- Until now the trigger ALWAYS replaced the number with the next generated one (migration 156 made it SECURITY DEFINER and closed direct calls to the generator).
-- It now keeps a number that is exactly ZOHO- and digits, but ONLY when the insert is not made by a signed-in user or the anonymous role (the server's key, an
-- administrator's SQL session). A person using the data API with their own token (role authenticated / anon) still always gets a generated number, so nobody can choose
-- or fake a ZOHO- number. (A signed-in user also has no INSERT right on requests at all - VAPT VA-DB-02 - so this is a second lock.) The column is already UNIQUE, so the
-- same Zoho number can never be used twice. Everything else is exactly as migration 156 left it.
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_assign_request_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- (inside a SECURITY DEFINER function current_user is the owner, so the caller's role is read from the session setting, which SET ROLE / PostgREST sets)
  IF coalesce(current_setting('role', true), '') NOT IN ('authenticated', 'anon') AND NEW.request_no ~ '^ZOHO-[0-9]{1,18}$' THEN
    RETURN NEW;
  END IF;
  NEW.request_no := generate_request_no();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_assign_request_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_assign_request_no() TO service_role;

COMMIT;
'@
$m198 = @'
-- 198: Zoho -> CK Desk transfer, STAGE 3: one row per "move everything that matches these filters" run, so there is always a record of who moved how many tickets, when,
-- with which filters, and which tickets failed and why. Additive: one new table, nothing existing changes. Server key only (same pattern as 191 / 196).
BEGIN;

CREATE TABLE IF NOT EXISTS public.zoho_transfer_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  state        text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'finished', 'stopped')),
  filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  asked        integer NOT NULL DEFAULT 0,
  moved        integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  failures     jsonb NOT NULL DEFAULT '[]'::jsonb   -- the first 200 failures: [{ "no": 48213, "reason": "..." }]
);
CREATE INDEX IF NOT EXISTS idx_zoho_transfer_runs_org ON public.zoho_transfer_runs (org_id, started_at DESC);

ALTER TABLE public.zoho_transfer_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.zoho_transfer_runs TO service_role;

COMMIT;
'@
$verify = @'
SELECT 'new tables' AS what, count(*)::text AS value FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('zoho_map_templates','zoho_map_services','zoho_map_categories','zoho_map_items','zoho_map_people','zoho_map_fields','zoho_map_values','zoho_transfers','zoho_transfer_runs')
UNION ALL SELECT 'number trigger keeps ZOHO- numbers', (position('ZOHO-' in pg_get_functiondef('public.trg_assign_request_no()'::regprocedure)) > 0)::text
UNION ALL SELECT 'trigger is SECURITY DEFINER', (SELECT prosecdef::text FROM pg_proc WHERE oid = 'public.trg_assign_request_no()'::regprocedure)
UNION ALL SELECT 'tables with row security on', count(*)::text FROM pg_class WHERE relname LIKE 'zoho\_%' AND relkind = 'r' AND relrowsecurity
UNION ALL SELECT 'existing tickets (unchanged)', count(*)::text FROM requests;
'@
$rollback = @'
-- ROLLBACK of migrations 196-198 (run as postgres on database ckdesk). Only needed if the new feature must be removed; no ticket is touched.
BEGIN;
DROP TABLE IF EXISTS public.zoho_transfer_runs, public.zoho_transfers, public.zoho_map_values, public.zoho_map_fields, public.zoho_map_people, public.zoho_map_items, public.zoho_map_categories, public.zoho_map_services, public.zoho_map_templates;
-- the ticket-number trigger as migration 156 left it
CREATE OR REPLACE FUNCTION public.trg_assign_request_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.request_no := generate_request_no();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_assign_request_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_assign_request_no() TO service_role;
COMMIT;
'@
$files = [ordered]@{ '00-check.sql' = $check; '196.sql' = $m196; '197.sql' = $m197; '198.sql' = $m198; 'verify.sql' = $verify; 'rollback-196-198.sql' = $rollback }
foreach ($k in $files.Keys) { [IO.File]::WriteAllText((Join-Path $work $k), $files[$k], (New-Object Text.UTF8Encoding($false))) }

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  Write-Host "`n[1/4] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h localhost -d ckdesk -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/4] Checking the prerequisites ..." -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -f (Join-Path $work '00-check.sql')
  if ($LASTEXITCODE -ne 0) { throw "A prerequisite is missing. Nothing was changed. Send the message above to Claude." }

  Write-Host "`n[3/4] Applying migrations 196, 197, 198 ..." -ForegroundColor Cyan
  foreach ($f in '196.sql', '197.sql', '198.sql') {
    Write-Host "  - $f" -ForegroundColor Cyan
    & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -f (Join-Path $work $f)
    if ($LASTEXITCODE -ne 0) { throw "Migration $f FAILED and was rolled back (each one is all-or-nothing). Send the message above to Claude." }
  }

  Write-Host "`n[4/4] Verification (expect: new tables = 9, keeps ZOHO- numbers = true, SECURITY DEFINER = true, row security on = 9, existing tickets = your normal count) ..." -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -f (Join-Path $work 'verify.sql')
  if ($LASTEXITCODE -ne 0) { throw "Verification query failed." }
  Write-Host "`nDONE. Backup: $backupFile" -ForegroundColor Green
  Write-Host "Rollback file (only if ever needed): $(Join-Path $work 'rollback-196-198.sql')" -ForegroundColor Yellow
  Write-Host "Now tell Claude 'migrations done' so the helper service on 98 is restarted and the app deployed." -ForegroundColor Green
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
