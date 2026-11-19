# Citykart Desk - database tuning for the ckdesk database ONLY (no restart, no other database on this server is touched).
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   .\run-ckdesk-db-tuning.ps1            apply the settings (the old values are written to a text file first, so nothing is lost)
#   .\run-ckdesk-db-tuning.ps1 -Show      only show what is set now (changes nothing)
#   .\run-ckdesk-db-tuning.ps1 -Undo      take every one of these settings away again (the database goes back to the server defaults)
# Why: the server is still on its install defaults, which are made for a small PC with a spinning disk. Citykart Desk's database is on an SSD and small enough to sit in memory, so
#   random_page_cost 1.1   : the planner stops being afraid of index look-ups (the default 4 assumes a spinning disk) -> better plans, less work per query
#   effective_cache_size   : tells the planner that about 16 GB of this 24 GB server is available as cache (it reserves nothing; it is only a hint for planning)
#   jit off                : the just-in-time compiler adds 50-300 ms of CPU to a query before it starts; for short app queries it only costs
#   work_mem 16MB          : a sort or join of a few thousand rows stays in memory instead of spilling to disk (default 4MB); about 40 connections x a few steps = well under 3 GB at the very worst
#   track_io_timing        : lets us see later how much time queries spend reading the disk
#   log_min_duration_statement 500ms : every statement slower than half a second is written to the PostgreSQL log, so slow ones can be found and fixed (nothing else is logged)
#   log_lock_waits         : a statement that waits for a lock more than 1 s is logged with who blocked it
# These are settings of the ckdesk DATABASE only (ALTER DATABASE ... SET), so they apply to NEW connections to ckdesk from now on. The data service (PostgREST) keeps its connections for up to
# 30 minutes, so the full effect arrives within half an hour by itself; for it to start at once, restart the CkDeskPostgrest service on 10.0.1.98 (about 3 seconds, optional).
# Safe while the app is live. No table, row or user is changed. Nothing is applied to other databases on this server.
param([switch]$Undo, [switch]$Show)
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$noteDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $noteDir)) { $noteDir = $env:TEMP }
$beforeFile = Join-Path $noteDir "ckdesk-db-settings-before-tuning-$stamp.txt"
$sqlFile = Join-Path $env:TEMP "ckdesk-db-tuning-$stamp.sql"

$settings = [ordered]@{
  random_page_cost           = '1.1'
  effective_cache_size       = '16GB'
  jit                        = 'off'
  work_mem                   = '16MB'
  track_io_timing            = 'on'
  log_min_duration_statement = '500ms'
  log_lock_waits             = 'on'
}
$names = ($settings.Keys | ForEach-Object { "'$_'" }) -join ', '
$showSql = "SELECT s.name, s.setting AS value_now, s.unit, s.source FROM pg_settings s WHERE s.name IN ($names) ORDER BY s.name; SELECT CASE WHEN c ~* '(key|secret|token|password)' THEN split_part(c, '=', 1) || '=(hidden)' ELSE c END AS set_for_ckdesk_database FROM (SELECT unnest(setconfig) AS c FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = 'ckdesk') AND setrole = 0) t ORDER BY 1;"

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  if ($Show) {
    Write-Host "`nWhat the ckdesk database uses now:" -ForegroundColor Cyan
    & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -c $showSql
    return
  }

  if ($Undo) {
    Write-Host "`nTaking the tuning settings away again ..." -ForegroundColor Cyan
    $undo = ($settings.Keys | ForEach-Object { "ALTER DATABASE ckdesk RESET $_;" }) -join "`n"
    [IO.File]::WriteAllText($sqlFile, $undo + "`n" + $showSql, (New-Object Text.UTF8Encoding($false)))
    & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
    if ($LASTEXITCODE -ne 0) { throw "Undo FAILED (exit $LASTEXITCODE). Nothing was changed." }
    Write-Host "`nDone. The second table should now be empty (nothing set for the ckdesk database)." -ForegroundColor Green
    return
  }

  Write-Host "`n[1/3] Writing down what is set now to $beforeFile ..." -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 -c $showSql | Out-File -FilePath $beforeFile -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Could not read the current settings. Nothing was changed." }

  Write-Host "`n[2/3] Applying the settings to the ckdesk database ..." -ForegroundColor Cyan
  $apply = ($settings.GetEnumerator() | ForEach-Object { "ALTER DATABASE ckdesk SET $($_.Key) = '$($_.Value)';" }) -join "`n"
  [IO.File]::WriteAllText($sqlFile, $apply + "`n" + $showSql, (New-Object Text.UTF8Encoding($false)))
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged." }

  Write-Host "`n[3/3] Done. The second table above must list 7 settings (random_page_cost, effective_cache_size, jit, work_mem, track_io_timing, log_min_duration_statement, log_lock_waits)." -ForegroundColor Green
  Write-Host "They apply to new connections; the app's data service picks them up within 30 minutes by itself (or restart CkDeskPostgrest on 10.0.1.98 to make it immediate)." -ForegroundColor Yellow
  Write-Host "To take them away again:  .\run-ckdesk-db-tuning.ps1 -Undo     Old values are in: $beforeFile" -ForegroundColor Yellow
  Write-Host "Then tell Claude 'db tuning done'." -ForegroundColor Yellow
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $sqlFile -ErrorAction SilentlyContinue
}
