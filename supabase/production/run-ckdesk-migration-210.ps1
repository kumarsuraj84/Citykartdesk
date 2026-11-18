# Citykart Desk - live database update: migration 210 (Reports pivot speed: one read-only function) with a backup first.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   1. takes a full backup of database ckdesk and checks the backup file can be read back
#   2. only if the backup is good, applies migration 210 in ONE all-or-nothing transaction: it ADDS ONE read-only function, public.report_request_aggregates(uuid), that counts
#      comments / attachments / collaborators / minutes / ratings per ticket in one call. No table, ticket, user or setting is touched. Only the server key can call it.
#   3. prints a verification (expect: functions = 1, recorded = 1) and then tries the function once (expect a number of tickets counted). Re-running is harmless.
# Safe while the app is live. The app falls back to the old way by itself while the function is missing, so this can be run before or after the app release.
# After it, restart the data service on 98 once (service CkDeskPostgrest) so it sees the new function.
# Rollback (only if ever needed; nothing else depends on it):  DROP FUNCTION public.report_request_aggregates(uuid);
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-migration-210-$stamp.dump"
$sqlFile = Join-Path $env:TEMP "ckdesk-migration-210-$stamp.sql"

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  Write-Host "`n[1/3] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h localhost -d ckdesk -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/3] Applying migration 210 (one read-only function for the Reports pivot) ..." -ForegroundColor Cyan
  $sql = @'
-- Citykart Desk production database update: migration 210. Run as postgres on database ckdesk.
-- 210: Report Builder / pivot speed. One function that returns, for every ticket of an organization, the five per-ticket numbers the report needs
-- (collaborators, live attachments, comments, tracked minutes, CSAT rating). Purely additive: a new read-only function, no table or row is changed.

DROP FUNCTION IF EXISTS public.report_request_aggregates(uuid);
CREATE OR REPLACE FUNCTION public.report_request_aggregates(p_org uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_array(x.id, x.collaborators, x.attachments, x.comments, x.minutes, x.rating)), '[]'::jsonb)
    FROM (
      SELECT r.id,
             (SELECT count(*)::integer FROM public.request_collaborators c WHERE c.request_id = r.id) AS collaborators,
             (SELECT count(*)::integer FROM public.request_attachments a WHERE a.request_id = r.id AND a.deleted_at IS NULL) AS attachments,
             (SELECT count(*)::integer FROM public.request_comments m WHERE m.request_id = r.id) AS comments,
             (SELECT COALESCE(sum(GREATEST(0, round(EXTRACT(EPOCH FROM (t.stopped_at - t.started_at)) / 60.0))), 0)::integer
                FROM public.request_time_entries t WHERE t.request_id = r.id AND t.stopped_at IS NOT NULL) AS minutes,
             (SELECT s.rating::integer FROM public.csat_surveys s WHERE s.request_id = r.id AND s.rating IS NOT NULL ORDER BY s.id DESC LIMIT 1) AS rating
        FROM public.requests r
       WHERE r.org_id = p_org
    ) x;
$$;

REVOKE ALL ON FUNCTION public.report_request_aggregates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_request_aggregates(uuid) TO service_role;

-- ===== record the migration =====
DO $$ BEGIN
  INSERT INTO auth.schema_migrations (version) VALUES ('20240101000210') ON CONFLICT DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not record the version in auth.schema_migrations (no permission); the change itself was applied.';
END $$;

NOTIFY pgrst, 'reload schema';

-- ===== check =====
SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'report_request_aggregates') AS functions,
       (SELECT count(*) FROM auth.schema_migrations WHERE version = '20240101000210') AS recorded;
'@
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "Migration FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged. Backup is at $backupFile" }

  Write-Host "`n[3/3] Trying the new function once (read-only) ..." -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -c "SELECT o.id AS organization, jsonb_array_length(public.report_request_aggregates(o.id)) AS tickets_counted FROM public.organizations o LIMIT 3;"
  if ($LASTEXITCODE -ne 0) { Write-Host "The trial call did not run (not a problem for the update itself; tell Claude what you see)." -ForegroundColor Yellow }

  Write-Host "`nDone. In the first table above you should see: functions = 1, recorded = 1." -ForegroundColor Green
  Write-Host "Backup kept at: $backupFile"
  Write-Host "Next: restart the service CkDeskPostgrest on 10.0.1.98 once, then tell Claude 'migration 210 done'." -ForegroundColor Yellow
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $sqlFile -ErrorAction SilentlyContinue
}
