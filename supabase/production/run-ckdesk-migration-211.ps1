# Citykart Desk - live database update: migration 211 (fixes "infinite recursion detected in policy for relation request_time_entries") with a backup first.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   1. takes a full backup of database ckdesk and checks the backup file can be read back
#   2. only if the backup is good, applies migration 211 in ONE all-or-nothing transaction: it replaces the UPDATE rule of request_time_entries and csat_surveys (they read their own
#      table, which Postgres refuses) with a simple owner rule, and adds two small triggers that stop a signed-in user from re-pointing a row at another ticket.
#      No ticket, time entry, survey, user or setting is changed.
#   3. prints a verification (expect: time_rule_ok = 1, survey_rule_ok = 1, triggers = 2, recorded = 1 or 0 is fine). Re-running is harmless.
# Safe while the app is live. After it, restart the data service on 98 once (service CkDeskPostgrest).
# Rollback (only if ever needed): restore the two rules from migration 167 - ask Claude for the exact statements.
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-migration-211-$stamp.dump"
$sqlFile = Join-Path $env:TEMP "ckdesk-migration-211-$stamp.sql"

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  Write-Host "`n[1/3] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h localhost -d ckdesk -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/3] Applying migration 211 (time entry and survey update rules) ..." -ForegroundColor Cyan
  $sql = @'
-- Citykart Desk production database update: migration 211. Run as postgres on database ckdesk.
-- 211: fix "infinite recursion detected in policy for relation request_time_entries" (error 42P17).
--
-- Migration 167 made the UPDATE rules of request_time_entries and csat_surveys refuse to re-point a row at another ticket by comparing request_id with
-- "(SELECT request_id FROM <the same table> WHERE id = ...)". A rule that reads its OWN table is refused by Postgres as infinite recursion, so EVERY update of a time
-- entry made as a signed-in user failed (445 times between 30 Oct and 19 Nov: the technician's previous timer was not stopped when the status changed, so work time was overcounted).
--
-- The same protection is now done where it belongs: the rule only checks WHO owns the row, and a small trigger refuses to change request_id for a signed-in user (the same
-- way guard_attachment_client_write protects attachments). The server's own key (service_role) is not limited, as before.
-- Purely a rule/trigger change: no row of any table is touched. Safe to run while the app is live; restart the data service (CkDeskPostgrest) afterwards.

-- ── time entries ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS time_entries_update ON public.request_time_entries;
CREATE POLICY time_entries_update ON public.request_time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_time_entry_request_unchanged()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'a time entry cannot be moved to another ticket' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_time_entry_request_unchanged ON public.request_time_entries;
CREATE TRIGGER trg_time_entry_request_unchanged
  BEFORE UPDATE ON public.request_time_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_time_entry_request_unchanged();

-- ── survey answers: the same pattern (a requester answers his own open survey, and cannot re-point it at another ticket) ────────────────────
DROP POLICY IF EXISTS csat_update_requester ON public.csat_surveys;
CREATE POLICY csat_update_requester ON public.csat_surveys FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() AND submitted_at IS NULL)
  WITH CHECK (requester_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_csat_request_unchanged()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'a survey answer cannot be moved to another ticket' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_csat_request_unchanged ON public.csat_surveys;
CREATE TRIGGER trg_csat_request_unchanged
  BEFORE UPDATE ON public.csat_surveys
  FOR EACH ROW EXECUTE FUNCTION public.guard_csat_request_unchanged();

NOTIFY pgrst, 'reload schema';

-- ===== record the migration =====
DO $$ BEGIN
  INSERT INTO auth.schema_migrations (version) VALUES ('20240101000211') ON CONFLICT DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not record the version in auth.schema_migrations (no permission); the change itself was applied.';
END $$;

-- ===== check =====
SELECT (SELECT count(*) FROM pg_policies WHERE tablename = 'request_time_entries' AND policyname = 'time_entries_update' AND with_check = '(user_id = auth.uid())') AS time_rule_ok,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'csat_surveys' AND policyname = 'csat_update_requester' AND with_check = '(requester_id = auth.uid())') AS survey_rule_ok,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_time_entry_request_unchanged', 'trg_csat_request_unchanged') AND NOT tgisinternal) AS triggers,
       (SELECT count(*) FROM auth.schema_migrations WHERE version = '20240101000211') AS recorded;
'@
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "Migration FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged. Backup is at $backupFile" }

  Write-Host "`nDone. In the table above you should see: time_rule_ok = 1, survey_rule_ok = 1, triggers = 2 (recorded = 1 or 0 is fine)." -ForegroundColor Green
  Write-Host "Backup kept at: $backupFile"
  Write-Host "Next: restart the service CkDeskPostgrest on 10.0.1.98 once, then tell Claude 'migration 211 done'." -ForegroundColor Yellow
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $sqlFile -ErrorAction SilentlyContinue
}
