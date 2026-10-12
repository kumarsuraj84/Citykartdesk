# Citykart Desk - live database update (migration 154: Store Master fields on Stores) with a backup first.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   1. takes a full backup of database ckdesk (and checks the backup file is readable)
#   2. only if the backup is good, adds 10 empty columns to the "stores" table in ONE all-or-nothing transaction
# Additive and safe while the app is live. Re-running is harmless (IF NOT EXISTS / ON CONFLICT).
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-store-master-$stamp.dump"
$sqlFile = Join-Path $env:TEMP "ckdesk-migration-154-$stamp.sql"

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  Write-Host "`n[1/3] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h localhost -d ckdesk -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/3] Applying migration 154 (Store Master fields) ..." -ForegroundColor Cyan
  $sql = @'
-- Citykart Desk production database update: migration 154. Run as postgres on database ckdesk.

-- ===== 20240101000154_store_master_fields =====
-- Store Master fields kept per store (previously only in an Excel sheet).
-- Generic to every store: cluster, region, priority_list, open_date, festival (city and state already exist).
-- AC service only (used for AC issues / OEM and AMC follow-up): ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix.
-- All optional; filled by hand on a store or by uploading the Store Master sheet.
-- (city and state already exist on stores.)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS ac_total      integer CHECK (ac_total IS NULL OR ac_total >= 0),
  ADD COLUMN IF NOT EXISTS ac_brand      text,
  ADD COLUMN IF NOT EXISTS ac_amc_brand     text,
  ADD COLUMN IF NOT EXISTS ac_amc_vendor    text,
  ADD COLUMN IF NOT EXISTS zenatix       boolean,
  ADD COLUMN IF NOT EXISTS open_date     date,
  ADD COLUMN IF NOT EXISTS cluster       text,
  ADD COLUMN IF NOT EXISTS region        text,
  ADD COLUMN IF NOT EXISTS priority_list text,
  ADD COLUMN IF NOT EXISTS festival      text;

COMMENT ON COLUMN stores.ac_total      IS 'AC service only: number of ACs installed in the store';
COMMENT ON COLUMN stores.ac_brand      IS 'AC service only: brand of the installed ACs';
COMMENT ON COLUMN stores.ac_amc_brand  IS 'AC service only: brand that holds the AC AMC (annual maintenance contract)';
COMMENT ON COLUMN stores.ac_amc_vendor IS 'AC service only: vendor company that services the ACs under the AMC';
COMMENT ON COLUMN stores.zenatix       IS 'AC service only: whether the store has Zenatix AC monitoring';
COMMENT ON COLUMN stores.open_date     IS 'Date the store opened (null while pending)';
COMMENT ON COLUMN stores.priority_list IS 'e.g. Top 50 / ROS';

-- ===== record the migration =====
DO $$ BEGIN
  INSERT INTO auth.schema_migrations (version) VALUES ('20240101000154') ON CONFLICT DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not record the version in auth.schema_migrations (no permission); the change itself was applied.';
END $$;

-- ===== check =====
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='stores' AND column_name IN
          ('ac_total','ac_brand','ac_amc_brand','ac_amc_vendor','zenatix','open_date','cluster','region','priority_list','festival')) AS new_columns,
       (SELECT count(*) FROM stores) AS stores_untouched,
       (SELECT count(*) FROM auth.schema_migrations WHERE version = '20240101000154') AS recorded;
'@
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "Migration FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged. Backup is at $backupFile" }

  Write-Host "`n[3/3] Done. In the table above you should see: new_columns = 10, recorded = 1 (stores_untouched is just your store count)." -ForegroundColor Green
  Write-Host "Backup kept at: $backupFile"
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $sqlFile -ErrorAction SilentlyContinue
}
