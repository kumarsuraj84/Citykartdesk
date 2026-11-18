# Citykart Desk - live database update: migration 201 (Health & Performance phases 2-4: servers, real users, alerts) with a backup first.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   1. takes a full backup of database ckdesk and checks the backup file can be read back
#   2. only if the backup is good, applies migration 201 in ONE all-or-nothing transaction: it ADDS two new tables (health_metrics, rum_samples), eight small functions and one trigger (a bell notification for platform owners when an outage opens / recovers), and replaces health_prune with a version that also clears the new tables
#      that only the server key can call. No existing table, ticket, user or setting is touched.
#   3. prints a verification (expect: tables = 2, functions = 9, recorded = 1). Re-running is harmless (everything is "if not exists" / "create or replace").
# Safe while the app is live. After it, restart the data service on 98 once (service CkDeskPostgrest) so it sees the new tables, then ask Claude to continue.
# Rollback (only if ever needed; nothing else depends on it): DROP TRIGGER health_incidents_notify ON public.health_incidents; DROP TABLE public.health_metrics, public.rum_samples; DROP FUNCTION public.health_metric_series(text,integer,integer), public.health_db_stats(), public.rum_summary(integer), public.rum_by_route(integer,integer), public.rum_by_viewport(integer), public.rum_layout_issues(integer,integer), public.health_notify_incident(), public.health_check_label(text);
#   (the earlier health_prune from migration 200 keeps working: re-run the health_prune part of migration 200 to put it back; leaving the new one in place is harmless).
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-migration-201-$stamp.dump"
$sqlFile = Join-Path $env:TEMP "ckdesk-migration-201-$stamp.sql"

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  Write-Host "`n[1/3] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h localhost -d ckdesk -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/3] Applying migration 201 (Health & Performance tables) ..." -ForegroundColor Cyan
  $sql = @'
-- Citykart Desk production database update: migration 201. Run as postgres on database ckdesk.
-- 201: Health & Performance, phases 2-4 (servers, real users, alerts). Two new tables, functions and one trigger; nothing existing changes (health_prune is replaced by a version that also clears the new tables).
--   phase 2  health_metrics, health_metric_series, health_db_stats   server numbers for the charts, and the database server's own load
--   phase 3  rum_samples and rum_* functions                        what real users' browsers measured (page load, largest paint, layout shift, screen width, content cut off); no name, e-mail or user id
--   phase 4  health_notify_incident (trigger on health_incidents)    every platform owner gets a bell notification (portal only) when an outage opens and when it recovers
--   health_metrics        one number per metric per minute: server CPU %, memory %, free disk % (C:, D:, the NAS), database connections % and size. Charts read it.
--   health_metric_series  a metric over time in buckets (average, highest) for the charts.
--   health_db_stats       the database server's own load figures (connections used, size, longest running query), read by the app's checks. Read-only, server key only.

CREATE TABLE IF NOT EXISTS public.health_metrics (
  id      bigserial PRIMARY KEY,
  at      timestamptz      NOT NULL DEFAULT now(),
  metric  text             NOT NULL,
  value   double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS health_metrics_metric_at ON public.health_metrics (metric, at DESC);
CREATE INDEX IF NOT EXISTS health_metrics_at ON public.health_metrics (at);
ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_metrics TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.health_metrics_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.health_metric_series(p_metric text, p_hours integer DEFAULT 24, p_bucket_min integer DEFAULT 10)
RETURNS TABLE (bucket timestamptz, samples bigint, avg_value double precision, max_value double precision, min_value double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_timestamp(floor(EXTRACT(EPOCH FROM hm.at) / (GREATEST(p_bucket_min, 1) * 60)) * (GREATEST(p_bucket_min, 1) * 60)) AS bucket,
         count(*), avg(hm.value), max(hm.value), min(hm.value)
    FROM public.health_metrics hm
   WHERE hm.metric = p_metric AND hm.at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 45)))
   GROUP BY 1 ORDER BY 1;
$$;

-- The database server's load right now. Connections are counted for this database only; the longest query ignores idle sessions and maintenance (autovacuum, replication).
CREATE OR REPLACE FUNCTION public.health_db_stats()
RETURNS TABLE (connections integer, max_connections integer, db_size_mb numeric, longest_query_seconds numeric, waiting_locks integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT (SELECT count(*)::integer FROM pg_stat_activity WHERE datname = current_database()),
         current_setting('max_connections')::integer,
         ROUND(pg_database_size(current_database()) / 1048576.0, 1),
         COALESCE((SELECT ROUND(max(EXTRACT(EPOCH FROM (now() - query_start)))::numeric, 1)
                     FROM pg_stat_activity
                    WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
                      AND backend_type = 'client backend' AND query NOT ILIKE 'autovacuum:%'), 0),
         (SELECT count(*)::integer FROM pg_locks WHERE NOT granted);
$$;

-- Keeps the tables small (45 days of samples, speed windows and metrics; 400 days of closed outages). Same as 200 plus the new table.
CREATE OR REPLACE FUNCTION public.health_prune()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; k integer;
BEGIN
  DELETE FROM public.health_samples WHERE at < now() - interval '45 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.perf_windows WHERE at < now() - interval '45 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.health_metrics WHERE at < now() - interval '45 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.rum_samples WHERE at < now() - interval '30 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.health_incidents WHERE ended_at IS NOT NULL AND ended_at < now() - interval '400 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;

-- ───────── phase 3: real users ─────────
-- One row per report from a signed-in person's browser. kind 'vitals' = once per full page load (speed), kind 'layout' = once per screen visited (width and whether content is cut off).
-- No name, e-mail or user id is stored: only the screen (with ids removed from its address), the browser's own timings and the window width.
CREATE TABLE IF NOT EXISTS public.rum_samples (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text    NOT NULL CHECK (kind IN ('vitals','layout')),
  route       text    NOT NULL,
  viewport_w  integer NOT NULL,
  vclass      text    NOT NULL CHECK (vclass IN ('phone','tablet','laptop','desktop')),
  ttfb_ms     integer,
  load_ms     integer,
  lcp_ms      integer,
  cls         real,
  inp_ms      integer,
  overflow_px integer
);
CREATE INDEX IF NOT EXISTS rum_samples_at ON public.rum_samples (at DESC);
CREATE INDEX IF NOT EXISTS rum_samples_route_at ON public.rum_samples (route, at DESC);
ALTER TABLE public.rum_samples ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rum_samples TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.rum_samples_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.rum_summary(p_hours integer DEFAULT 24)
RETURNS TABLE (loads bigint, views bigint, lcp_p50 integer, lcp_p75 integer, lcp_p95 integer, load_p50 integer, load_p95 integer, ttfb_p50 integer, cls_p75 real, inp_p75 integer, poor_lcp bigint, cut_off_views bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (SELECT * FROM public.rum_samples WHERE at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 30))))
  SELECT (SELECT count(*) FROM r WHERE kind = 'vitals'),
         (SELECT count(*) FROM r WHERE kind = 'layout'),
         (SELECT percentile_disc(0.5)  WITHIN GROUP (ORDER BY lcp_ms)  FROM r WHERE kind = 'vitals' AND lcp_ms IS NOT NULL)::integer,
         (SELECT percentile_disc(0.75) WITHIN GROUP (ORDER BY lcp_ms)  FROM r WHERE kind = 'vitals' AND lcp_ms IS NOT NULL)::integer,
         (SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY lcp_ms)  FROM r WHERE kind = 'vitals' AND lcp_ms IS NOT NULL)::integer,
         (SELECT percentile_disc(0.5)  WITHIN GROUP (ORDER BY load_ms) FROM r WHERE kind = 'vitals' AND load_ms IS NOT NULL)::integer,
         (SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY load_ms) FROM r WHERE kind = 'vitals' AND load_ms IS NOT NULL)::integer,
         (SELECT percentile_disc(0.5)  WITHIN GROUP (ORDER BY ttfb_ms) FROM r WHERE kind = 'vitals' AND ttfb_ms IS NOT NULL)::integer,
         (SELECT percentile_disc(0.75) WITHIN GROUP (ORDER BY cls)     FROM r WHERE kind = 'vitals' AND cls IS NOT NULL)::real,
         (SELECT percentile_disc(0.75) WITHIN GROUP (ORDER BY inp_ms)  FROM r WHERE kind = 'vitals' AND inp_ms IS NOT NULL)::integer,
         (SELECT count(*) FROM r WHERE kind = 'vitals' AND lcp_ms > 4000),
         (SELECT count(*) FROM r WHERE kind = 'layout' AND COALESCE(overflow_px, 0) > 0);
$$;

-- The screens people waited longest on (75th percentile of the largest paint), only screens with at least 3 full loads.
CREATE OR REPLACE FUNCTION public.rum_by_route(p_hours integer DEFAULT 24, p_limit integer DEFAULT 15)
RETURNS TABLE (route text, loads bigint, lcp_p75 integer, load_p95 integer, ttfb_p50 integer, cls_p75 real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.route, count(*),
         percentile_disc(0.75) WITHIN GROUP (ORDER BY s.lcp_ms)::integer,
         percentile_disc(0.95) WITHIN GROUP (ORDER BY s.load_ms)::integer,
         percentile_disc(0.5)  WITHIN GROUP (ORDER BY s.ttfb_ms)::integer,
         percentile_disc(0.75) WITHIN GROUP (ORDER BY s.cls)::real
    FROM public.rum_samples s
   WHERE s.kind = 'vitals' AND s.at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 30)))
   GROUP BY s.route HAVING count(*) >= 3
   ORDER BY 3 DESC NULLS LAST LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

-- Screen sizes in use, and how often content was cut off on each.
CREATE OR REPLACE FUNCTION public.rum_by_viewport(p_hours integer DEFAULT 24)
RETURNS TABLE (vclass text, views bigint, cut_off_views bigint, loads bigint, lcp_p75 integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.vclass, count(*) FILTER (WHERE s.kind = 'layout'), count(*) FILTER (WHERE s.kind = 'layout' AND COALESCE(s.overflow_px, 0) > 0),
         count(*) FILTER (WHERE s.kind = 'vitals'), (percentile_disc(0.75) WITHIN GROUP (ORDER BY s.lcp_ms) FILTER (WHERE s.kind = 'vitals'))::integer
    FROM public.rum_samples s
   WHERE s.at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 30)))
   GROUP BY s.vclass ORDER BY 2 DESC;
$$;

-- Screens where content was wider than the page (cut off or needing a sideways scroll), per screen size.
CREATE OR REPLACE FUNCTION public.rum_layout_issues(p_hours integer DEFAULT 24, p_limit integer DEFAULT 20)
RETURNS TABLE (route text, vclass text, views bigint, cut_off_views bigint, max_overflow_px integer, avg_viewport_w integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.route, s.vclass, count(*), count(*) FILTER (WHERE COALESCE(s.overflow_px, 0) > 0),
         max(s.overflow_px)::integer, avg(s.viewport_w)::integer
    FROM public.rum_samples s
   WHERE s.kind = 'layout' AND s.at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 30)))
   GROUP BY s.route, s.vclass HAVING count(*) FILTER (WHERE COALESCE(s.overflow_px, 0) > 0) > 0
   ORDER BY 4 DESC, 5 DESC LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

-- ───────── phase 4: alerts (portal only) ─────────
CREATE OR REPLACE FUNCTION public.health_check_label(k text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE k
    WHEN 'app' THEN 'CK Desk app' WHEN 'database' THEN 'Database' WHEN 'auth' THEN 'Sign-in service' WHEN 'storage' THEN 'File service'
    WHEN 'postgrest' THEN 'Data service' WHEN 'proxy' THEN 'Gateway' WHEN 'nas_files' THEN 'File storage (NAS)' WHEN 'services' THEN 'Windows services'
    WHEN 'server_cpu' THEN 'App server CPU' WHEN 'server_memory' THEN 'App server memory' WHEN 'server_disk' THEN 'Disk space' WHEN 'db_load' THEN 'Database server load'
    WHEN 'page_speed' THEN 'Page speed' WHEN 'sync_zoho' THEN 'Zoho sync' WHEN 'sync_google_sheets' THEN 'Google Sheet syncs' WHEN 'sync_email' THEN 'E-mail intake poll'
    WHEN 'sync_weather' THEN 'Weather' ELSE initcap(replace(k, '_', ' ')) END
$$;

-- A bell notification for every active platform owner when an outage opens and when it recovers. Portal only: nothing is e-mailed or pushed from here.
CREATE OR REPLACE FUNCTION public.health_notify_incident()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT p.id, 'business_rule_notification', 'Health alert: ' || public.health_check_label(NEW.check_key) || ' needs attention',
           COALESCE(NEW.detail, 'The check failed 3 times in a row.'), '/health'
      FROM public.profiles p WHERE p.role = 'platform_owner' AND p.is_active;
  ELSIF TG_OP = 'UPDATE' AND OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT p.id, 'business_rule_notification', 'Health recovered: ' || public.health_check_label(NEW.check_key) || ' is working again',
           'It was down for ' || GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60.0))::text || ' min.', '/health'
      FROM public.profiles p WHERE p.role = 'platform_owner' AND p.is_active;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS health_incidents_notify ON public.health_incidents;
CREATE TRIGGER health_incidents_notify AFTER INSERT OR UPDATE OF ended_at ON public.health_incidents FOR EACH ROW EXECUTE FUNCTION public.health_notify_incident();

REVOKE ALL ON FUNCTION public.health_metric_series(text, integer, integer), public.health_db_stats(), public.rum_summary(integer), public.rum_by_route(integer, integer),
              public.rum_by_viewport(integer), public.rum_layout_issues(integer, integer), public.health_check_label(text), public.health_notify_incident() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_metric_series(text, integer, integer), public.health_db_stats(), public.rum_summary(integer), public.rum_by_route(integer, integer),
              public.rum_by_viewport(integer), public.rum_layout_issues(integer, integer), public.health_check_label(text) TO service_role;


-- ===== record the migration =====
DO $$ BEGIN
  INSERT INTO auth.schema_migrations (version) VALUES ('20240101000201') ON CONFLICT DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not record the version in auth.schema_migrations (no permission); the change itself was applied.';
END $$;

-- ===== check =====
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('health_metrics','rum_samples')) AS tables,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('health_metric_series','health_db_stats','health_prune','rum_summary','rum_by_route','rum_by_viewport','rum_layout_issues','health_check_label','health_notify_incident')) AS functions,
       (SELECT count(*) FROM auth.schema_migrations WHERE version = '20240101000201') AS recorded;
'@
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "Migration FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged. Backup is at $backupFile" }

  Write-Host "`n[3/3] Done. In the table above you should see: tables = 2, functions = 9, recorded = 1." -ForegroundColor Green
  Write-Host "Backup kept at: $backupFile"
  Write-Host "Next: restart the service CkDeskPostgrest on 10.0.1.98 once, then tell Claude 'migration 201 done'." -ForegroundColor Yellow
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $sqlFile -ErrorAction SilentlyContinue
}
