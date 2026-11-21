# Citykart Desk - READ-ONLY timing of the access-rule function that got stuck on 20 Nov (current_user_approver_request_ids), so we can see WHY it is sometimes slow.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   .\check-ckdesk-approver-function.ps1
# It changes NOTHING: everything runs inside one read-only transaction that is rolled back at the end, it writes no file, and it prints only counts, times and short ids
# (no names, no ticket text, no passwords or keys). It pretends to be a few people for a moment (an approver with many approvals, an administrator, a store user) to time what
# the rule does for each of them.
# Copy everything it prints and send it to Claude. Takes well under a minute (each step is stopped after 2 minutes at most).
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  $sql = @'
\pset pager off
\set ON_ERROR_STOP off
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

\echo === 1. how much the rule has to work on
SELECT (SELECT count(*) FROM approvals) AS approvals, (SELECT count(*) FROM approval_workflow_steps WHERE approver_type = 'specific_user') AS named_approver_steps,
       (SELECT count(*) FROM approval_workflows) AS workflows, (SELECT count(*) FROM requests) AS tickets, (SELECT count(*) FROM profiles) AS people;
\echo
\echo === 2. how fresh the planner statistics are (times are the server own clock, US Pacific = India time minus 13h30m)
SELECT relname AS table_name, n_live_tup AS live_rows, n_dead_tup AS dead_rows, n_mod_since_analyze AS changes_since_analyze,
       to_char(last_analyze, 'DD Mon HH24:MI') AS last_analyze, to_char(last_autoanalyze, 'DD Mon HH24:MI') AS last_autoanalyze, to_char(last_autovacuum, 'DD Mon HH24:MI') AS last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('approvals', 'approval_workflow_steps', 'requests', 'profiles', 'team_members', 'notifications', 'request_collaborators')
ORDER BY relname;
\echo
\echo === 3. timing and planner settings given to this database or to the data service roles (only these kinds of setting are shown)
SELECT coalesce(r.rolname, '(everyone)') AS for_role, c AS setting
FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole CROSS JOIN LATERAL unnest(s.setconfig) AS c
WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
  AND c ~ '^(statement_timeout|lock_timeout|plan_cache_mode|random_page_cost|work_mem|jit|effective_cache_size|idle_in_transaction_session_timeout|log_min_duration_statement|track_io_timing)='
ORDER BY 1, 2;
\echo
\echo === 4. the people tested: short id, role, and how many tickets have an approval that names them
WITH heavy AS (
  SELECT s.approver_user_id AS uid, count(DISTINCT a.request_id) AS approvals_behind
  FROM approval_workflow_steps s JOIN approvals a ON a.workflow_id = s.workflow_id
  WHERE s.approver_type = 'specific_user'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5
), others AS (
  (SELECT id AS uid, 0::bigint AS approvals_behind FROM profiles WHERE role = 'platform_owner' AND is_active ORDER BY created_at LIMIT 1)
  UNION ALL (SELECT id, 0::bigint FROM profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1)
  UNION ALL (SELECT id, 0::bigint FROM profiles WHERE role = 'agent' AND is_active ORDER BY created_at LIMIT 1)
  UNION ALL (SELECT id, 0::bigint FROM profiles WHERE role = 'user' AND is_active AND NOT coalesce(must_reset_password, false) ORDER BY created_at LIMIT 1)
), pick AS (
  SELECT uid, max(approvals_behind) AS approvals_behind FROM (SELECT * FROM heavy UNION ALL SELECT * FROM others) x GROUP BY uid
)
SELECT left(k.uid::text, 8) AS person, p.role, k.approvals_behind FROM pick k JOIN profiles p ON p.id = k.uid ORDER BY k.approvals_behind DESC, p.role;
\echo
\echo === 5. per person: how long the rule function takes, and how long plain reads take WITH the access rules applied (what the app really does). Times in milliseconds.
WITH heavy AS (
  SELECT s.approver_user_id AS uid, count(DISTINCT a.request_id) AS approvals_behind
  FROM approval_workflow_steps s JOIN approvals a ON a.workflow_id = s.workflow_id
  WHERE s.approver_type = 'specific_user'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5
), others AS (
  (SELECT id AS uid, 0::bigint AS approvals_behind FROM profiles WHERE role = 'platform_owner' AND is_active ORDER BY created_at LIMIT 1)
  UNION ALL (SELECT id, 0::bigint FROM profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1)
  UNION ALL (SELECT id, 0::bigint FROM profiles WHERE role = 'agent' AND is_active ORDER BY created_at LIMIT 1)
  UNION ALL (SELECT id, 0::bigint FROM profiles WHERE role = 'user' AND is_active AND NOT coalesce(must_reset_password, false) ORDER BY created_at LIMIT 1)
), pick AS (
  SELECT uid, max(approvals_behind) AS approvals_behind FROM (SELECT * FROM heavy UNION ALL SELECT * FROM others) x GROUP BY uid
)
SELECT stmt FROM (
  SELECT uid::text AS u, 1 AS seq, format('DO $x$ BEGIN PERFORM set_config(%L, %L, false); END $x$', 'ck.uid', uid::text) AS stmt FROM pick
  UNION ALL
  SELECT uid::text, 2, $q$DO $do$
DECLARE
  uid uuid := current_setting('ck.uid')::uuid;
  r text; t0 timestamptz; a uuid[]; n bigint; f_ms numeric; req_ms numeric; prof_ms numeric; not_ms numeric; app_ms numeric;
BEGIN
  SELECT role::text INTO r FROM public.profiles WHERE id = uid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp(); a := public.current_user_approver_request_ids(); f_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  t0 := clock_timestamp(); SELECT count(*) INTO n FROM public.requests; req_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  RAISE NOTICE '%  % : rule function % ms (% tickets) | read all visible tickets % ms (% rows)', left(uid::text, 8), r, f_ms, coalesce(array_length(a, 1), 0), req_ms, n;
  t0 := clock_timestamp(); SELECT count(*) INTO n FROM public.profiles; prof_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  t0 := clock_timestamp(); SELECT count(*) INTO n FROM public.notifications; not_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  t0 := clock_timestamp(); SELECT count(*) INTO n FROM public.approvals; app_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  RAISE NOTICE '%  % : people % ms | notifications % ms | approvals % ms', left(uid::text, 8), r, prof_ms, not_ms, app_ms;
  EXECUTE 'RESET ROLE';
END
$do$$q$ FROM pick
) x ORDER BY u, seq
\gexec
\echo
\echo === 6. the rule function own work for the person with the most approvals: the plan the server chooses and where the time goes
WITH heavy AS (
  SELECT s.approver_user_id AS uid, count(DISTINCT a.request_id) AS approvals_behind
  FROM approval_workflow_steps s JOIN approvals a ON a.workflow_id = s.workflow_id
  WHERE s.approver_type = 'specific_user'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 1
)
SELECT uid AS heavy_uid FROM heavy
\gset
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(array_agg(DISTINCT a.request_id), '{}'::uuid[])
FROM approvals a
JOIN approval_workflow_steps aws ON aws.workflow_id = a.workflow_id
JOIN requests r ON r.id = a.request_id
WHERE aws.approver_type = 'specific_user' AND aws.approver_user_id = :'heavy_uid'::uuid
  AND r.org_id = (SELECT org_id FROM profiles WHERE id = :'heavy_uid'::uuid);
\echo
\echo === 7. anything running for more than 2 seconds in this database right now (text with values removed)
SELECT pid, usename AS login, state, now() - query_start AS running_for, wait_event_type AS waiting_on,
       left(regexp_replace(regexp_replace(query, '''[^'']*''', '''?''', 'g'), '\s+', ' ', 'g'), 140) AS statement_start
FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid() AND now() - query_start > interval '2 seconds'
ORDER BY running_for DESC LIMIT 10;
\echo
\echo === 8. memory cache facts: how often this database finds what it needs already in memory (shared_buffers is the cache the 128 MB question is about)
SELECT round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS found_in_postgres_cache_pct, blks_read AS read_from_disk_or_os_cache, pg_size_pretty(pg_database_size(datname)) AS database_size, stats_reset
FROM pg_stat_database WHERE datname = current_database();
SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers', 'shared_preload_libraries', 'max_connections') ORDER BY name;
SELECT count(*) AS pg_stat_statements_installed FROM pg_extension WHERE extname = 'pg_stat_statements';
ROLLBACK;
'@
  $f = Join-Path $env:TEMP 'ckdesk-approver-function-check.sql'
  [IO.File]::WriteAllText($f, $sql, (New-Object Text.UTF8Encoding($false)))
  # psql reports its progress notices on the error channel; they are results here, not errors, so PowerShell must not stop on them
  $ErrorActionPreference = 'Continue'
  # full ids (they appear once in the plan of step 6) are shortened, so the printout holds no id at all
  & "$pgBin\psql.exe" -U postgres -h localhost -d ckdesk -f $f 2>&1 | ForEach-Object { ("$_" -replace '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '<id>') }
  Write-Host "`nDone (nothing was changed). Copy everything above and send it to Claude." -ForegroundColor Green
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $env:TEMP 'ckdesk-approver-function-check.sql') -ErrorAction SilentlyContinue
}
