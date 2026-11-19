# Citykart Desk - READ-ONLY look at how busy each database on the server 10.0.0.205 is, so that we can see how much of the server each application uses.
# Run on 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored. It changes NOTHING (only reads the server's own counters) and shows no table data.
#   .\check-205-load-by-database.ps1
# Copy everything it prints and send it to Claude.
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  $sql = @'
\echo === 1. server uptime and size of every database
SELECT now() - pg_postmaster_start_time() AS running_for, version() AS version;
SELECT datname AS database, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE NOT datistemplate ORDER BY pg_database_size(datname) DESC;
\echo
\echo === 2. work done by each database since the counters were last reset (a bigger number = a busier application)
SELECT datname AS database, numbackends AS connections_now, xact_commit + xact_rollback AS transactions, tup_returned + tup_fetched AS rows_read, tup_inserted + tup_updated + tup_deleted AS rows_written,
       blks_read AS disk_blocks_read, blks_hit AS memory_blocks_hit, round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 1) AS cache_hit_pct, stats_reset
FROM pg_stat_database WHERE datname IS NOT NULL AND datname NOT IN ('template0', 'template1') ORDER BY xact_commit + xact_rollback DESC;
\echo
\echo === 3. connections right now, by database and login name
SELECT datname AS database, usename AS login, state, count(*) AS connections FROM pg_stat_activity WHERE datname IS NOT NULL GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
\echo
\echo === 4. the settings that decide how much memory the whole server may use
SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers', 'max_connections', 'effective_cache_size', 'work_mem', 'shared_preload_libraries') ORDER BY name;
'@
  $f = Join-Path $env:TEMP 'ckdesk-205-load.sql'
  [IO.File]::WriteAllText($f, $sql, (New-Object Text.UTF8Encoding($false)))
  & "$pgBin\psql.exe" -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 -f $f
  Write-Host "`nDone (nothing was changed). Copy everything above and send it to Claude." -ForegroundColor Green
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $env:TEMP 'ckdesk-205-load.sql') -ErrorAction SilentlyContinue
}
