# Citykart Desk - live database update: migration 212 (a 20 second limit for every single database statement sent by signed-in people and by anonymous visitors).
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   .\run-ckdesk-migration-212.ps1            apply it (a full backup of ckdesk is taken first and checked)
#   .\run-ckdesk-migration-212.ps1 -Undo      take the limit away again (no backup needed: only two role settings are removed)
# What it does: sets statement_timeout = 20s on the two roles the screens use (authenticated, anon). A statement that runs longer is cancelled and frees its connection, so one
# runaway search can no longer block everybody. The server's own key (scheduled jobs, Zoho move, reports) is NOT limited. No table, row or user is changed.
# Safe while the app is live. The data service re-reads the setting by itself (the script tells it to); no restart is needed.
# Expected at the end: roles_with_20s = 2
param([switch]$Undo)
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-migration-212-$stamp.dump"
$sqlFile = Join-Path $env:TEMP "ckdesk-migration-212-$stamp.sql"

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  if ($Undo) {
    Write-Host "`nTaking the 20 second limit away again ..." -ForegroundColor Cyan
    $undoSql = @'
ALTER ROLE authenticated RESET statement_timeout;
ALTER ROLE anon RESET statement_timeout;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
SELECT count(*) AS roles_with_20s FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname IN ('authenticated', 'anon') AND s.setdatabase = 0 AND 'statement_timeout=20s' = ANY (s.setconfig);
'@
    [IO.File]::WriteAllText($sqlFile, $undoSql, (New-Object Text.UTF8Encoding($false)))
    & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
    if ($LASTEXITCODE -ne 0) { throw "Undo FAILED (exit $LASTEXITCODE). Nothing was changed." }
    Write-Host "`nDone. roles_with_20s should now be 0: the limit is removed." -ForegroundColor Green
    return
  }

  Write-Host "`n[1/3] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h localhost -d ckdesk -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/3] Applying migration 212 (20 second limit for signed-in people and visitors) ..." -ForegroundColor Cyan
  $sql = @'
-- Citykart Desk production database update: migration 212. Run as postgres on database ckdesk.
-- 212: a time limit of 20 seconds for every single database statement sent by signed-in people (role authenticated) and by anonymous visitors (role anon).
-- A statement that runs longer is cancelled (error 57014) and frees its connection. The server's own key (service_role) is not limited.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r, '20s');
    END IF;
  END LOOP;
END $$;

-- the data service reads the settings of a role together with its table list, so both are reloaded (about 0.2 s, requests are not interrupted)
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- ===== record the migration =====
DO $$ BEGIN
  INSERT INTO auth.schema_migrations (version) VALUES ('20240101000212') ON CONFLICT DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not record the version in auth.schema_migrations (no permission); the change itself was applied.';
END $$;

-- ===== check =====
SELECT count(*) AS roles_with_20s FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname IN ('authenticated', 'anon') AND s.setdatabase = 0 AND 'statement_timeout=20s' = ANY (s.setconfig);
'@
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "Migration FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged. Backup is at $backupFile" }

  Write-Host "`n[3/3] Done. In the table above you should see: roles_with_20s = 2." -ForegroundColor Green
  Write-Host "Backup kept at: $backupFile"
  Write-Host "No restart is needed. To take the limit away again later:  .\run-ckdesk-migration-212.ps1 -Undo" -ForegroundColor Yellow
  Write-Host "Then tell Claude 'migration 212 done'." -ForegroundColor Yellow
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $sqlFile -ErrorAction SilentlyContinue
}
