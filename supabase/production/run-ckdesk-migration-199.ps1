# Citykart Desk - live database update: migration 199 (allow Excel .xlsb attachments in the file storage lists) with a backup first.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   1. takes a full backup of database ckdesk and checks the backup file can be read back
#   2. checks the file storage list table exists
#   3. applies migration 199 in ONE all-or-nothing transaction: it only ADDS the two spellings of the .xlsb type to the allowed-type lists of three storage buckets
#      (request-attachments, task-attachments, intake-attachments). No ticket, user, file or setting is changed.
#   4. prints a short verification. Re-running is harmless (a type already in a list is not added twice).
# Background: the same change was already made on the live system by hand on 2026-11-17, so today this script changes nothing ("0 lists changed" is the normal answer).
# It is only needed so the database matches the migration files if it is ever rebuilt or restored onto a new server.
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-migration-199-$stamp.dump"
$work = Join-Path $env:TEMP "ckdesk-migration-199-$stamp"; New-Item -ItemType Directory -Force $work | Out-Null

$check = @'
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RAISE EXCEPTION 'storage.buckets is not in this database (is the file storage in another database?). Nothing to do here; tell Claude.'; END IF;
  RAISE NOTICE 'storage.buckets found';
END $$;
SELECT id, cardinality(allowed_mime_types) AS types_in_list FROM storage.buckets WHERE id IN ('request-attachments', 'task-attachments', 'intake-attachments') ORDER BY id;
'@
$m199 = @'
-- 199: Excel binary workbooks (.xlsb) are allowed as attachments (owner's decision of 2026-11-17; Zoho tickets carry them).
-- The application's own list already allows the type and still refuses a workbook that carries a macro project; the storage buckets keep a list of their own, so the type is added there too.
-- Browsers and Zoho label it in lower case, so both spellings are added. Safe to run twice. A bucket that has no list at all (anything goes) is left alone.
BEGIN;
DO $$
DECLARE
  b text;
  t text;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  FOREACH b IN ARRAY ARRAY['request-attachments', 'task-attachments', 'intake-attachments'] LOOP
    FOREACH t IN ARRAY ARRAY['application/vnd.ms-excel.sheet.binary.macroEnabled.12', 'application/vnd.ms-excel.sheet.binary.macroenabled.12'] LOOP
      UPDATE storage.buckets SET allowed_mime_types = array_append(allowed_mime_types, t)
       WHERE id = b AND allowed_mime_types IS NOT NULL AND NOT (t = ANY (allowed_mime_types));
    END LOOP;
  END LOOP;
END $$;
COMMIT;
'@
$verify = @'
SELECT id AS bucket,
       cardinality(allowed_mime_types) AS types_in_list,
       ('application/vnd.ms-excel.sheet.binary.macroEnabled.12' = ANY (allowed_mime_types)) AS has_xlsb,
       ('application/vnd.ms-excel.sheet.binary.macroenabled.12' = ANY (allowed_mime_types)) AS has_xlsb_lowercase
  FROM storage.buckets WHERE id IN ('request-attachments', 'task-attachments', 'intake-attachments') ORDER BY id;
'@
$rollback = @'
-- ROLLBACK of migration 199 (run as postgres on database ckdesk). Only needed if .xlsb must be refused again at the storage level; no ticket or file is touched.
-- (Also remove 'xlsb' from lib/attachments/validate.ts in the app, or uploads will be refused by the storage with "could not be stored".)
BEGIN;
UPDATE storage.buckets
   SET allowed_mime_types = array_remove(array_remove(allowed_mime_types, 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'), 'application/vnd.ms-excel.sheet.binary.macroenabled.12')
 WHERE id IN ('request-attachments', 'task-attachments', 'intake-attachments') AND allowed_mime_types IS NOT NULL;
COMMIT;
'@
$files = [ordered]@{ '00-check.sql' = $check; '199.sql' = $m199; 'verify.sql' = $verify; 'rollback-199.sql' = $rollback }
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

  Write-Host "`n[2/4] Checking the storage lists exist ..." -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -f (Join-Path $work '00-check.sql')
  if ($LASTEXITCODE -ne 0) { throw "The storage list table is not here. Nothing was changed. Send the message above to Claude." }

  Write-Host "`n[3/4] Applying migration 199 ..." -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -f (Join-Path $work '199.sql')
  if ($LASTEXITCODE -ne 0) { throw "Migration 199 FAILED and was rolled back (it is all-or-nothing). Send the message above to Claude." }

  Write-Host "`n[4/4] Verification (expect: three rows, has_xlsb = t and has_xlsb_lowercase = t on each) ..." -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -f (Join-Path $work 'verify.sql')
  if ($LASTEXITCODE -ne 0) { throw "Verification query failed." }
  Write-Host "`nDONE. Backup: $backupFile" -ForegroundColor Green
  Write-Host "Rollback file (only if ever needed): $(Join-Path $work 'rollback-199.sql')" -ForegroundColor Yellow
  Write-Host "Nothing else is needed: no restart, no deploy. Tell Claude 'migration 199 done'." -ForegroundColor Green
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
