# Run on 10.0.0.205 by the person who knows the PostgreSQL "postgres" password.
# READ ONLY. Writes ONE small file next to this script: the id and the e-mail address of each login (so the test copy on the developer PC knows who is who).
# NOT included: passwords, password hashes, tokens, phone numbers, anything else of the login table.
#
# How to run (PowerShell ON 10.0.0.205), in the folder with this file:
#   $env:PGPASSWORD = Read-Host "postgres password"
#   .\export-live-people-for-local.ps1
# Then copy live-people-for-local-<date>.csv to the developer PC, into  D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate\local-testing\
param(
  [string]$BinDir   = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$Database = 'ckdesk',
  [string]$OutDir   = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
if (-not $env:PGPASSWORD) { throw 'Set $env:PGPASSWORD first (see the notes at the top of this file).' }
$psql = Join-Path $BinDir 'psql.exe'
if (-not (Test-Path $psql)) { throw "not found: $psql (use -BinDir to point at the PostgreSQL bin folder)" }
$file = Join-Path $OutDir ("live-people-for-local-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
& $psql -U postgres -h localhost -d $Database -v ON_ERROR_STOP=1 -c "\copy (select id, lower(email) as email from auth.users where email is not null order by created_at) to '$file' with (format csv, header true)"
if ($LASTEXITCODE -ne 0) { throw 'The export failed - nothing was changed on the live system.' }
$n = (Get-Content $file | Measure-Object -Line).Lines - 1
"file: $file  ($n logins)"
"DONE. Copy that file to the developer PC (folder local-testing) and tell me 'copied'. Nothing was changed on the live system."
