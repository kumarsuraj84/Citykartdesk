# Run on 10.0.0.205 by the person who knows the PostgreSQL "postgres" password (nobody else needs it).
# Applies the Citykart Desk migrations in this folder's "migrations" subfolder, in order, each in ONE transaction, and records each version in
# auth.schema_migrations (the runbook's way). It stops at the first failure and tells you which file; nothing after it is run.
#
# Before you start:
#   1. Take a backup:  run the scheduled task CK_Backup_CKDESK (or a manual pg_dump -Fc) and check backup.log says OK.
#   2. Open a PowerShell window ON 10.0.0.205 and type:   $env:PGPASSWORD = Read-Host "postgres password"   (it stays in that window only)
#   3. Run:  .\run-migrations.ps1
# Afterwards restart CkDeskPostgrest on 10.0.1.98 (so it sees the new tables and functions).
param(
  [string]$Dir = (Join-Path $PSScriptRoot 'migrations'),
  [string]$Psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$Database = 'ckdesk'
)
$ErrorActionPreference = 'Stop'
if (-not $env:PGPASSWORD) { throw 'Set $env:PGPASSWORD first (see the notes at the top of this file).' }

$q = '-U', 'postgres', '-h', 'localhost', '-d', $Database
"Highest versions already recorded:"
& $Psql @q -At -c "select version from auth.schema_migrations where version like '20240101%' order by 1 desc limit 3"

foreach ($f in Get-ChildItem $Dir -Filter '*.sql' | Sort-Object Name) {
  $version = ($f.Name -split '_')[0]
  $done = & $Psql @q -At -c "select count(*) from auth.schema_migrations where version = '$version'"
  if ($done.Trim() -eq '1') { "SKIP  $($f.Name) (already recorded)"; continue }
  "RUN   $($f.Name)"
  & $Psql @q -v ON_ERROR_STOP=1 --single-transaction -f $f.FullName
  if ($LASTEXITCODE -ne 0) { throw "FAILED in $($f.Name). Nothing after it was run. Send the message above to your developer." }
  & $Psql @q -c "insert into auth.schema_migrations (version) values ('$version') on conflict do nothing"
  "OK    $($f.Name)"
}
"All migrations applied. Now restart CkDeskPostgrest on 10.0.1.98."
