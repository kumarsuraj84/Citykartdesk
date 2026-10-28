# Run on 10.0.0.205 by the person who knows the PostgreSQL "postgres" password.
# READ ONLY: it only READS the live database (pg_dump) and writes ONE file next to this script. It changes nothing on the live system.
# The file is a copy of the live DATA of the "public" tables (stores, people, services, categories, tickets, ...), used to refresh the test copy on the developer PC.
# Left OUT on purpose (never leaves 205): login passwords and tokens (auth schema), saved mail settings and mailbox connections, intake mail contents, push
# subscriptions, approval codes, system / event / audit logs, DeskTime logs. Attachment FILES are not included either (they stay on the NAS).
#
# How to run (PowerShell ON 10.0.0.205):
#   cd to the folder with this file, then:
#   $env:PGPASSWORD = Read-Host "postgres password"      # stays in this window only; never typed into the script
#   .\export-live-data-for-local.ps1
# Then copy the file it names (live-data-for-local-<date>.dump) to the developer PC, into  D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate\local-testing\
param(
  [string]$BinDir   = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$Database = 'ckdesk',
  [string]$OutDir   = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
if (-not $env:PGPASSWORD) { throw 'Set $env:PGPASSWORD first (see the notes at the top of this file).' }
$psql = Join-Path $BinDir 'psql.exe'; $pgdump = Join-Path $BinDir 'pg_dump.exe'; $pgrestore = Join-Path $BinDir 'pg_restore.exe'
foreach ($p in $psql, $pgdump, $pgrestore) { if (-not (Test-Path $p)) { throw "not found: $p (use -BinDir to point at the PostgreSQL bin folder)" } }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = Join-Path $OutDir "live-data-for-local-$stamp.dump"
$q = '-U', 'postgres', '-h', 'localhost', '-d', $Database

"--- what is in the live database now (read-only counts)"
& $psql @q -At -F ' | ' -c "select 'stores', count(*) from public.stores union all select 'people', count(*) from public.profiles union all select 'tickets', count(*) from public.requests union all select 'services', count(*) from public.services union all select 'highest migration', max(version)::bigint from auth.schema_migrations where version like '20240101%'"

"--- exporting (data of the public tables only, sensitive tables left out)"
$skip = @(
  'public.email_smtp_settings', 'public.intake_*', 'public.push_subscriptions', 'public.approval_email_codes', 'public.processed_inbound_emails',
  'public.system_log', 'public.system_log_archive', 'public.system_log_chain_head', 'public.app_event_log', 'public.admin_audit_log', 'public.owner_audit_log',
  'public.desktime_app_logs', 'public.desktime_time_logs', 'public.webhook_seen'
) | ForEach-Object { "--exclude-table-data=$_" }
& $pgdump -U postgres -h localhost -d $Database -Fc --data-only --schema=public --no-owner --no-acl --disable-triggers @skip -f $file
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed - nothing was changed on the live system.' }

$items = & $pgrestore -l $file | Measure-Object -Line
$mb = [math]::Round((Get-Item $file).Length / 1MB, 1)
"file: $file  ($mb MB, $($items.Lines) items readable)"
if ($mb -lt 0.5 -or $items.Lines -lt 50) { throw 'The file looks too small or unreadable.' }
"DONE. Copy that file to the developer PC (folder local-testing) and tell me 'copied'. Nothing was changed on the live system."
