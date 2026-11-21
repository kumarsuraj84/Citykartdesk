# Citykart Desk - live database update: migration 213 (the access rules of the busiest tables ask their helpers once per query instead of once per row).
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   .\run-ckdesk-migration-213.ps1            apply it (a full backup of ckdesk is taken first and checked; a before / after check of what people can read is printed)
#   .\run-ckdesk-migration-213.ps1 -Undo      put every rule back exactly as it was (uses rollback-ckdesk-migration-213.sql; the backup is not needed for this)
# Needs these two files in the same folder:  20240101000213_wrap_rls_helper_calls.sql  and  rollback-ckdesk-migration-213.sql
# What it does: 36 read rules (policies) of the busiest tables are dropped and created again in ONE step, with the helper calls (who is this person, which organisation, which role, which groups, is this
# person an approver) written so that they are asked once per query, not once for every row. Who may see what does NOT change. No table, row or user is changed. Safe while the app is live (a second).
# Afterwards restart the data service on 10.0.1.98 (Claude does that): Restart-Service CkDeskPostgrest.
param([switch]$Undo)
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"
# the connection can be pointed at another database for a rehearsal on a development PC (never needed on the server)
$dbHost = if ($env:CK_PGHOST) { $env:CK_PGHOST } else { 'localhost' }
$dbPort = if ($env:CK_PGPORT) { $env:CK_PGPORT } else { '5432' }
$dbName = if ($env:CK_PGDB) { $env:CK_PGDB } else { 'ckdesk' }
$here = $PSScriptRoot
$migFile = Join-Path $here '20240101000213_wrap_rls_helper_calls.sql'
$rbFile = Join-Path $here 'rollback-ckdesk-migration-213.sql'
foreach ($f in $migFile, $rbFile) { if (-not (Test-Path $f)) { throw "Missing file next to this script: $f" } }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-migration-213-$stamp.dump"
$checkFile = Join-Path $env:TEMP "ckdesk-213-check-$stamp.sql"
$reloadFile = Join-Path $env:TEMP "ckdesk-213-reload-$stamp.sql"

# read-only: for a handful of people (the ones with most approvals, and two of every role) how many rows of each busy table they can read, and how long reading approvals / people takes for them
$checkSql = @'
\pset pager off
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';
DO $f$
DECLARE
  p record; t text; n bigint; t0 timestamptz; ms numeric;
  tables text[] := ARRAY['approvals','approval_decisions','notifications','request_activity','request_comments','request_attachments','request_time_entries','profiles','team_members','stores','services','teams','requests'];
BEGIN
  FOR p IN
    (SELECT uid, 'approver' AS why FROM (SELECT s.approver_user_id AS uid, count(DISTINCT a.request_id) c FROM approval_workflow_steps s JOIN approvals a ON a.workflow_id = s.workflow_id WHERE s.approver_type = 'specific_user' GROUP BY 1 ORDER BY 2 DESC LIMIT 4) h)
    UNION ALL (SELECT id, 'platform_owner' FROM profiles WHERE role = 'platform_owner' AND is_active ORDER BY created_at LIMIT 2)
    UNION ALL (SELECT id, 'admin' FROM profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 2)
    UNION ALL (SELECT id, 'manager' FROM profiles WHERE role = 'manager' AND is_active ORDER BY created_at LIMIT 2)
    UNION ALL (SELECT id, 'agent' FROM profiles WHERE role = 'agent' AND is_active ORDER BY created_at LIMIT 2)
    UNION ALL (SELECT id, 'user' FROM profiles WHERE role = 'user' AND is_active AND NOT coalesce(must_reset_password, false) ORDER BY created_at LIMIT 2)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p.uid::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', p.uid::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    FOREACH t IN ARRAY tables LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      EXCEPTION WHEN OTHERS THEN n := -1;
      END;
      RAISE NOTICE 'ROWS % % % %', left(p.uid::text, 8), p.why, t, n;
    END LOOP;
    t0 := clock_timestamp(); PERFORM count(*) FROM public.approvals; ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
    RAISE NOTICE 'TIME % % approvals_read_ms %', left(p.uid::text, 8), p.why, ms;
    t0 := clock_timestamp(); PERFORM count(*) FROM public.profiles; ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
    RAISE NOTICE 'TIME % % people_read_ms %', left(p.uid::text, 8), p.why, ms;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $f$;
ROLLBACK;
'@
[IO.File]::WriteAllText($checkFile, $checkSql, (New-Object Text.UTF8Encoding($false)))
$reloadSql = "NOTIFY pgrst, 'reload schema';`r`nNOTIFY pgrst, 'reload config';`r`n"
[IO.File]::WriteAllText($reloadFile, $reloadSql, (New-Object Text.UTF8Encoding($false)))

# psql writes its notices and warnings on the error channel; they are not failures. Only its exit code decides.
function Invoke-Psql { $ErrorActionPreference = 'Continue'; & $psql -U postgres -h $dbHost -p $dbPort -d $dbName @args 2>&1 | ForEach-Object { "$_" }; return $LASTEXITCODE }

function Run-Check($label) {
  Write-Host "  reading what a few people can see ($label) ..." -ForegroundColor DarkCyan
  $ErrorActionPreference = 'Continue'
  $out = & $psql -U postgres -h $dbHost -p $dbPort -d $dbName -f $checkFile 2>&1 | ForEach-Object { "$_" }
  $ErrorActionPreference = 'Stop'
  return $out | Where-Object { $_ -match 'ROWS |TIME ' } | ForEach-Object { ($_ -replace '^.*NOTICE:\s+', '') }
}

if (-not $env:PGPASSWORD) {
  $secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
try {
  if ($Undo) {
    Write-Host "`nPutting every rule back exactly as it was ..." -ForegroundColor Cyan
    $out = Invoke-Psql -v ON_ERROR_STOP=1 -f $rbFile; $out | Select-Object -SkipLast 1
    if ($out[-1] -ne 0) { throw "Undo FAILED (exit $LASTEXITCODE). Nothing was changed." }
    [void](Invoke-Psql -f $reloadFile)
    Write-Host "`nDone. The old rules are back. Tell Claude to restart CkDeskPostgrest on 10.0.1.98." -ForegroundColor Green
    return
  }

  Write-Host "`n[1/5] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h $dbHost -p $dbPort -d $dbName -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/5] What a few people can read, and how long it takes, BEFORE the change ..." -ForegroundColor Cyan
  $before = Run-Check 'before'

  Write-Host "`n[3/5] Applying migration 213 (one step, all or nothing) ..." -ForegroundColor Cyan
  $out = Invoke-Psql -v ON_ERROR_STOP=1 -f $migFile; $out | Select-Object -SkipLast 1
  if ($out[-1] -ne 0) { throw "Migration FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged. Backup is at $backupFile" }
  [void](Invoke-Psql -f $reloadFile)

  Write-Host "`n[4/5] The same check AFTER the change ..." -ForegroundColor Cyan
  $after = Run-Check 'after'

  Write-Host "`n[5/5] Result" -ForegroundColor Cyan
  $rowsB = $before | Where-Object { $_ -like 'ROWS *' }; $rowsA = $after | Where-Object { $_ -like 'ROWS *' }
  $diff = Compare-Object $rowsB $rowsA
  Write-Host ("People x tables compared: {0}. Differences in what they can read: {1}" -f @($rowsB).Count, @($diff).Count)
  if (@($diff).Count -gt 0) { Write-Host "(a few can be new rows that arrived during the seconds between the two checks; send them to Claude)" -ForegroundColor Yellow; $diff | ForEach-Object { "  " + $_.SideIndicator + " " + $_.InputObject } }
  Write-Host "`nTimes in milliseconds (before ... after):"
  $tb = $before | Where-Object { $_ -like 'TIME *' }; $ta = $after | Where-Object { $_ -like 'TIME *' }
  for ($i = 0; $i -lt @($tb).Count; $i++) { '  {0,-58} ->  {1}' -f $tb[$i], ($ta[$i] -replace '^.* ', '') }
  Write-Host "`nBackup kept at: $backupFile"
  Write-Host "Next: tell Claude 'migration 213 done' (Claude restarts CkDeskPostgrest on 98 and watches the health). To put the old rules back:  .\run-ckdesk-migration-213.ps1 -Undo" -ForegroundColor Yellow
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $checkFile, $reloadFile -ErrorAction SilentlyContinue
}
