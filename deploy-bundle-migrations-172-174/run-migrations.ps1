# Run on 10.0.0.205 by the person who knows the PostgreSQL "postgres" password (nobody else needs it).
# Does, in this order, and stops at the first problem:
#   1. READ-ONLY look at the live database (how many tickets / people, which migrations are already in).
#   2. A fresh full backup of the ckdesk database (pg_dump), and a check that the backup file can be read back.
#   3. Applies migrations 172 to 174 one by one, each in ONE transaction (all or nothing), and records each version.
#   4. READ-ONLY look again (the counts must be the same as before).
# Every screen line is also saved to a log file next to this script - send me that file (or paste the screen).
#
# How to run (PowerShell ON 10.0.0.205):
#   cd to this folder, then:
#   $env:PGPASSWORD = Read-Host "postgres password"      # stays in this window only; never typed into the script
#   .\run-migrations.ps1
# Afterwards I restart CkDeskPostgrest and the app on 10.0.1.98 myself.
param(
  [string]$Dir      = (Join-Path $PSScriptRoot 'migrations'),
  [string]$BinDir   = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$Database = 'ckdesk',
  [string]$BackupDir = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
if (-not $env:PGPASSWORD) { throw 'Set $env:PGPASSWORD first (see the notes at the top of this file).' }
$psql = Join-Path $BinDir 'psql.exe'; $pgdump = Join-Path $BinDir 'pg_dump.exe'; $pgrestore = Join-Path $BinDir 'pg_restore.exe'
foreach ($p in $psql, $pgdump, $pgrestore) { if (-not (Test-Path $p)) { throw "not found: $p (use -BinDir to point at the PostgreSQL bin folder)" } }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Start-Transcript -Path (Join-Path $PSScriptRoot "run-migrations-172-174-$stamp.log") | Out-Null
$q = '-U', 'postgres', '-h', 'localhost', '-d', $Database

function Snapshot($title) {
  "--- $title (read-only)"
  & $psql @q -At -F ' | ' -c "select 'tickets', count(*) from public.requests union all select 'people', count(*) from public.profiles union all select 'people who must reset password', count(*) from public.profiles where must_reset_password union all select 'organisations', count(*) from public.organizations"
  "highest migrations recorded:"
  & $psql @q -At -c "select version from auth.schema_migrations where version like '20240101%' order by 1 desc limit 3"
}

try {
  Snapshot 'BEFORE'
  $has171 = & $psql @q -At -c "select count(*) from auth.schema_migrations where version = '20240101000171'"
  if ($has171.Trim() -ne '1') { throw 'Migration 171 is not recorded: the security release (164-171) must be applied first. Nothing was changed.' }

  "--- BACKUP"
  $dump = Join-Path $BackupDir "ckdesk-before-172-174-$stamp.dump"
  & $pgdump -U postgres -h localhost -d $Database -Fc -f $dump
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed - nothing was changed.' }
  $items = & $pgrestore -l $dump | Measure-Object -Line
  $mb = [math]::Round((Get-Item $dump).Length / 1MB, 1)
  "backup file: $dump  ($mb MB, $($items.Lines) items readable)"
  if ($mb -lt 1 -or $items.Lines -lt 100) { throw 'The backup looks too small or unreadable - nothing was changed.' }

  "--- MIGRATIONS"
  foreach ($f in Get-ChildItem $Dir -Filter '*.sql' | Sort-Object Name) {
    $version = ($f.Name -split '_')[0]
    $done = & $psql @q -At -c "select count(*) from auth.schema_migrations where version = '$version'"
    if ($done.Trim() -eq '1') { "SKIP  $($f.Name) (already recorded)"; continue }
    "RUN   $($f.Name)"
    & $psql @q -v ON_ERROR_STOP=1 --single-transaction -f $f.FullName
    if ($LASTEXITCODE -ne 0) { throw "FAILED in $($f.Name). That file was rolled back and nothing after it was run. Send me this log." }
    & $psql @q -c "insert into auth.schema_migrations (version) values ('$version') on conflict do nothing"
    "OK    $($f.Name)"
  }

  Snapshot 'AFTER'
  "new columns present (each should say 1):"
  & $psql @q -At -F ' | ' -c "select 'oems.kind', count(*) from information_schema.columns where table_schema='public' and table_name='oems' and column_name='kind' union all select 'stores.genset_oem_id', count(*) from information_schema.columns where table_schema='public' and table_name='stores' and column_name='genset_oem_id' union all select 'stores.cvm_id', count(*) from information_schema.columns where table_schema='public' and table_name='stores' and column_name='cvm_id' union all select 'service_categories.auto_cvm_approval', count(*) from information_schema.columns where table_schema='public' and table_name='service_categories' and column_name='auto_cvm_approval'"
  "DONE. Tell me 'done' - I will restart CkDeskPostgrest and the app on 10.0.1.98 now."
}
catch {
  "STOPPED: $($_.Exception.Message)"
  "The backup (if it was made) is in: $BackupDir. Send me this log; do not run anything else."
}
finally { Stop-Transcript | Out-Null }
