# Citykart Desk - what is the database busy with right now, and (only if you confirm) stop a runaway search. Run on the database server 10.0.0.205 in PowerShell.
# You type the postgres password when asked; it is never stored.
#   Part 1 (read-only): the queries running now, how long each has been running, and how big the messages table is.
#   Part 2 (asks first): if some SEARCH queries on the messages table (request_comments with ILIKE on the text) have been running longer than 15 seconds, it lists them and asks you to type YES.
#           Only then it cancels exactly those queries with pg_cancel_backend: that stops the running query only; nobody is disconnected and nothing is deleted or changed.
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$psql = "$pgBin\psql.exe"
if (-not (Test-Path $psql)) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
function Sql($q) { & $psql -U postgres -h localhost -d ckdesk -X -c $q }
try {
  Write-Host "`n[1/3] Queries running right now (longest first):" -ForegroundColor Cyan
  Sql "SELECT pid, usename AS who, state, round(extract(epoch FROM (now() - query_start))::numeric, 1) AS seconds, wait_event_type AS waiting_on, left(regexp_replace(query, '\s+', ' ', 'g'), 150) AS query FROM pg_stat_activity WHERE datname = 'ckdesk' AND state <> 'idle' AND pid <> pg_backend_pid() ORDER BY query_start LIMIT 25;"

  Write-Host "`n[2/3] How many connections, and the size of the messages table:" -ForegroundColor Cyan
  Sql "SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = 'ckdesk') AS connections, (SELECT count(*) FROM pg_stat_activity WHERE datname = 'ckdesk' AND state = 'active') AS active, (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS max_connections;"
  Sql "SELECT count(*) AS messages, pg_size_pretty(pg_total_relation_size('public.request_comments')) AS table_size, pg_size_pretty(avg(length(body))::bigint) AS average_text, pg_size_pretty(max(length(body))::bigint) AS biggest_text FROM public.request_comments;"

  Write-Host "`n[3/3] Search queries on the messages table running longer than 15 seconds:" -ForegroundColor Cyan
  $find = "SELECT pid, round(extract(epoch FROM (now() - query_start))::numeric, 1) AS seconds, left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query FROM pg_stat_activity WHERE datname = 'ckdesk' AND state = 'active' AND pid <> pg_backend_pid() AND now() - query_start > interval '15 seconds' AND query ~* 'request_comments' AND query ~* 'ilike' ORDER BY query_start;"
  Sql $find
  $count = (& $psql -U postgres -h localhost -d ckdesk -X -t -A -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'ckdesk' AND state = 'active' AND pid <> pg_backend_pid() AND now() - query_start > interval '15 seconds' AND query ~* 'request_comments' AND query ~* 'ilike';").Trim()
  if ($count -eq '0') {
    Write-Host "`nNo runaway search is running now. Nothing to stop. Copy everything above and send it to Claude." -ForegroundColor Green
  } else {
    Write-Host "`n$count search quer(y/ies) listed above have been running for more than 15 seconds." -ForegroundColor Yellow
    $answer = Read-Host "Type YES to cancel exactly those queries (nobody is disconnected, nothing is changed), anything else to leave them"
    if ($answer -ceq 'YES') {
      Sql "SELECT pid, pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity WHERE datname = 'ckdesk' AND state = 'active' AND pid <> pg_backend_pid() AND now() - query_start > interval '15 seconds' AND query ~* 'request_comments' AND query ~* 'ilike';"
      Write-Host "`nCancelled. The people who were searching see an error and can search again; the system should answer normally within a few seconds." -ForegroundColor Green
    } else { Write-Host "`nLeft as they are." }
  }
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
