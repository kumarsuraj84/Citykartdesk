
# Run on 10.0.0.205 by the person who knows the PostgreSQL "postgres" password (nobody else needs it).
# Does, in this order, and stops at the first problem:
#   1. READ-ONLY look at the live database (how many tickets / people, which migrations are already in).
#   2. Refuses to go on unless migration 174 is already recorded (the last migration that is live today).
#   3. A fresh full backup of the ckdesk database (pg_dump), and a check that the backup file can be read back.
#   4. Applies migrations 175, 177 to 185 one by one (there is NO 176: it was the engineer-visit module, which was dropped), each in ONE transaction
#      (all or nothing), and records each version in auth.schema_migrations.
#   5. READ-ONLY look again (the counts must be the same as before) and a list of the new tables / columns (each must say 1).
# Every screen line is also saved to a log file next to this script - keep that file (or send it to me).
#
# How to run (PowerShell ON 10.0.0.205):
#   cd to this folder, then:
#   $env:PGPASSWORD = Read-Host "postgres password"      # stays in this window only; never typed into the script
#   .\run-migrations.ps1
# Afterwards restart CkDeskPostgrest on 10.0.1.98 (new tables are not visible to the app until PostgREST is restarted), THEN deploy the app.
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
Start-Transcript -Path (Join-Path $PSScriptRoot "run-migrations-175-185-$stamp.log") | Out-Null
$q = '-U', 'postgres', '-h', 'localhost', '-d', $Database

function Snapshot($title) {
  "--- $title (read-only)"
  & $psql @q -At -F ' | ' -c "select 'tickets', count(*) from public.requests union all select 'people', count(*) from public.profiles union all select 'categories', count(*) from public.service_categories union all select 'stores', count(*) from public.stores"
  "highest migrations recorded:"
  & $psql @q -At -c "select version from auth.schema_migrations where version like '20240101%' order by 1 desc limit 3"
}

try {
  Snapshot 'BEFORE'
  $has174 = & $psql @q -At -c "select count(*) from auth.schema_migrations where version = '20240101000174'"
  if ($has174.Trim() -ne '1') { throw 'Migration 174 is not recorded: this bundle must start from the level that is live today (174). Nothing was changed.' }

  "--- BACKUP"
  $dump = Join-Path $BackupDir "ckdesk-before-175-185-$stamp.dump"
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
    if ($LASTEXITCODE -ne 0) { throw "FAILED in $($f.Name). That file was rolled back and nothing after it was run. Keep this log." }
    & $psql @q -c "insert into auth.schema_migrations (version) values ('$version') on conflict do nothing"
    "OK    $($f.Name)"
  }

  Snapshot 'AFTER'
  "new tables present (each should say 1):"
  & $psql @q -At -F ' | ' -c "select t, count(*) from (values ('master_sources'),('master_google_connection'),('master_ac_units'),('master_gensets'),('master_store_cvm'),('master_issues'),('master_mail_templates'),('request_master_snapshots'),('vendor_companies'),('vendor_requests'),('vendor_request_items'),('weather_city_geo'),('weather_city_daily'),('master_pms_dates'),('pms_ticket_log')) as v(t) left join information_schema.tables i on i.table_schema='public' and i.table_name=v.t group by t order by t"
  "new columns present (each should say 1):"
  & $psql @q -At -F ' | ' -c "select c, count(*) from (values ('profiles','vendor_company_id'),('profiles','vendor_role'),('service_categories','show_approval_history'),('service_categories','is_pms'),('master_ac_units','po_emails'),('master_ac_units','approver_emails'),('vendor_requests','version'),('vendor_requests','approver_ids')) as v(t,c) left join information_schema.columns i on i.table_schema='public' and i.table_name=v.t and i.column_name=v.c group by t, c order by t, c"
  "policy of the admin tables (should list admin and platform_owner only):"
  & $psql @q -At -c "select tablename || ' / ' || policyname from pg_policies where policyname in ('categories_admin','form_templates_admin','teams_admin') order by 1"
  "DONE. Next: restart CkDeskPostgrest on 10.0.1.98, then deploy the app (see the run sheet)."
}
catch {
  "STOPPED: $($_.Exception.Message)"
  "The backup (if it was made) is in: $BackupDir. Keep this log; do not run anything else."
}
finally { Stop-Transcript | Out-Null }
