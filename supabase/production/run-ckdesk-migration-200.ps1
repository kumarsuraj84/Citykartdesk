# Citykart Desk - live database update: migration 200 (Health & Performance monitoring tables) with a backup first.
# Run on the database server 10.0.0.205 in PowerShell. You type the postgres password when asked; it is never stored.
#   1. takes a full backup of database ckdesk and checks the backup file can be read back
#   2. only if the backup is good, applies migration 200 in ONE all-or-nothing transaction: it ADDS four new tables (health_samples, health_incidents, perf_windows,
#      health_check_settings) and seven small functions that only the server key can call. No existing table, ticket, user or setting is touched.
#   3. prints a verification (expect: tables = 4, functions = 7, recorded = 1). Re-running is harmless (everything is "if not exists" / "create or replace").
# Safe while the app is live. After it, restart the data service on 98 once (service CkDeskPostgrest) so it sees the new tables, then ask Claude to continue.
# Rollback (only if ever needed; nothing else depends on these): DROP TABLE public.health_samples, public.health_incidents, public.perf_windows, public.health_check_settings CASCADE;
#   DROP FUNCTION public.health_uptime(integer), public.health_series(text,integer,integer), public.health_daily(text,integer), public.perf_series(integer,integer),
#   public.perf_slowest(integer,integer), public.health_judge(text[],integer), public.health_prune();
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path "$pgBin\psql.exe")) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$psql = "$pgBin\psql.exe"; $pgDump = "$pgBin\pg_dump.exe"; $pgRestore = "$pgBin\pg_restore.exe"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = 'E:\DB BACKUP\CK_CKDESK_DBBACKUP'
if (-not (Test-Path $backupDir)) { $backupDir = Join-Path $env:TEMP 'ckdesk-backup'; New-Item -ItemType Directory -Force $backupDir | Out-Null }
$backupFile = Join-Path $backupDir "ckdesk-before-migration-200-$stamp.dump"
$sqlFile = Join-Path $env:TEMP "ckdesk-migration-200-$stamp.sql"

$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  Write-Host "`n[1/3] Backing up ckdesk to $backupFile ..." -ForegroundColor Cyan
  & $pgDump -U postgres -h localhost -d ckdesk -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Backup FAILED (exit $LASTEXITCODE). Nothing was changed." }
  & $pgRestore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup file could not be read back. Nothing was changed." }
  Write-Host ("Backup OK ({0:N1} MB)." -f ((Get-Item $backupFile).Length / 1MB)) -ForegroundColor Green

  Write-Host "`n[2/3] Applying migration 200 (Health & Performance tables) ..." -ForegroundColor Cyan
  $sql = @'
-- Citykart Desk production database update: migration 200. Run as postgres on database ckdesk.
-- 200: Health & Performance (platform monitoring), phase 1.
-- Four new tables and a few read-only report functions; nothing existing changes. Server key only (no grant and no policy for signed-in users, same pattern as 196):
-- the pages are read by the app with its own key, and the one-minute probe on the app server writes with the service key.
--   health_samples        one row per check per minute: did it answer, how fast (ms), a short plain detail (never a secret)
--   health_incidents      an outage: opened after 3 failed checks in a row, closed when the check answers again
--   perf_windows          the per-page speed figures the app already counted every 10 minutes (typical, 95th percentile, slowest, failures), now kept
--   health_check_settings which checks are switched on (so a check, for example the Zoho sync, can be switched off later without a new release)

CREATE TABLE IF NOT EXISTS public.health_samples (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  check_key  text        NOT NULL,
  ok         boolean     NOT NULL,
  ms         integer,
  detail     text
);
CREATE INDEX IF NOT EXISTS health_samples_key_at ON public.health_samples (check_key, at DESC);
CREATE INDEX IF NOT EXISTS health_samples_at ON public.health_samples (at);

CREATE TABLE IF NOT EXISTS public.health_incidents (
  id              bigserial PRIMARY KEY,
  check_key       text        NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  detail          text,
  failed_samples  integer     NOT NULL DEFAULT 1
);
-- at most ONE open incident per check
CREATE UNIQUE INDEX IF NOT EXISTS health_incidents_one_open ON public.health_incidents (check_key) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS health_incidents_started ON public.health_incidents (started_at DESC);

CREATE TABLE IF NOT EXISTS public.perf_windows (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  route      text    NOT NULL,
  method     text    NOT NULL,
  n          integer NOT NULL,
  p50        integer NOT NULL,
  p95        integer NOT NULL,
  max        integer NOT NULL,
  errors5xx  integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS perf_windows_at ON public.perf_windows (at DESC);

CREATE TABLE IF NOT EXISTS public.health_check_settings (
  check_key   text PRIMARY KEY,
  enabled     boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.health_samples        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_incidents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perf_windows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_check_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_samples, public.health_incidents, public.perf_windows, public.health_check_settings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.health_samples_id_seq, public.health_incidents_id_seq, public.perf_windows_id_seq TO service_role;

-- Uptime of every check over the last p_days: the minutes that had a good answer out of the minutes that have passed since monitoring began (a missing minute counts as down:
-- a stopped server cannot report, and the gap is exactly the signal).
CREATE OR REPLACE FUNCTION public.health_uptime(p_days integer DEFAULT 30)
RETURNS TABLE (check_key text, samples bigint, ok_samples bigint, first_at timestamptz, last_at timestamptz, expected bigint, uptime_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (SELECT now() - make_interval(days => GREATEST(1, LEAST(p_days, 45))) AS since),
  s AS (
    SELECT hs.check_key, count(*) AS samples, count(*) FILTER (WHERE hs.ok) AS ok_samples, min(hs.at) AS first_at, max(hs.at) AS last_at
      FROM public.health_samples hs, w WHERE hs.at >= w.since GROUP BY hs.check_key
  )
  SELECT s.check_key, s.samples, s.ok_samples, s.first_at, s.last_at,
         GREATEST(s.samples, CEIL(EXTRACT(EPOCH FROM (now() - s.first_at)) / 60.0))::bigint AS expected,
         ROUND(100.0 * s.ok_samples / GREATEST(s.samples, CEIL(EXTRACT(EPOCH FROM (now() - s.first_at)) / 60.0)), 2) AS uptime_pct
    FROM s ORDER BY s.check_key;
$$;

-- One check over time in buckets (for the charts): how many answers, how many good, typical / 95th percentile / slowest ms.
CREATE OR REPLACE FUNCTION public.health_series(p_check text, p_hours integer DEFAULT 24, p_bucket_min integer DEFAULT 10)
RETURNS TABLE (bucket timestamptz, samples bigint, ok_samples bigint, p50_ms integer, p95_ms integer, max_ms integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_timestamp(floor(EXTRACT(EPOCH FROM hs.at) / (GREATEST(p_bucket_min, 1) * 60)) * (GREATEST(p_bucket_min, 1) * 60)) AS bucket,
         count(*) AS samples, count(*) FILTER (WHERE hs.ok) AS ok_samples,
         COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY hs.ms), 0)::integer,
         COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY hs.ms), 0)::integer,
         COALESCE(max(hs.ms), 0)::integer
    FROM public.health_samples hs
   WHERE hs.check_key = p_check AND hs.at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 45)))
   GROUP BY 1 ORDER BY 1;
$$;

-- Uptime per calendar day (India time) of one check, for the 30-day bar.
CREATE OR REPLACE FUNCTION public.health_daily(p_check text, p_days integer DEFAULT 30)
RETURNS TABLE (day date, samples bigint, ok_samples bigint, minutes_known integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (hs.at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS samples, count(*) FILTER (WHERE hs.ok) AS ok_samples,
         LEAST(1440, count(*))::integer
    FROM public.health_samples hs
   WHERE hs.check_key = p_check AND hs.at >= now() - make_interval(days => GREATEST(1, LEAST(p_days, 45)))
   GROUP BY 1 ORDER BY 1;
$$;

-- Page speed over time, all pages together (windows are 10 minutes each): total requests, typical (weighted), 95th percentile (weighted), slowest, failures (5xx).
CREATE OR REPLACE FUNCTION public.perf_series(p_hours integer DEFAULT 24, p_bucket_min integer DEFAULT 30)
RETURNS TABLE (bucket timestamptz, n bigint, p50 integer, p95 integer, max integer, errors5xx bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_timestamp(floor(EXTRACT(EPOCH FROM pw.at) / (GREATEST(p_bucket_min, 1) * 60)) * (GREATEST(p_bucket_min, 1) * 60)) AS bucket,
         sum(pw.n)::bigint, (sum(pw.p50::bigint * pw.n) / NULLIF(sum(pw.n), 0))::integer, (sum(pw.p95::bigint * pw.n) / NULLIF(sum(pw.n), 0))::integer,
         max(pw.max)::integer, sum(pw.errors5xx)::bigint
    FROM public.perf_windows pw
   WHERE pw.at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 45)))
   GROUP BY 1 ORDER BY 1;
$$;

-- The slowest pages in the last p_hours (by 95th percentile, only pages that were asked at least 5 times).
CREATE OR REPLACE FUNCTION public.perf_slowest(p_hours integer DEFAULT 24, p_limit integer DEFAULT 15)
RETURNS TABLE (route text, method text, requests bigint, p50 integer, p95 integer, slowest integer, errors5xx bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pw.route, pw.method, sum(pw.n)::bigint,
         (sum(pw.p50::bigint * pw.n) / NULLIF(sum(pw.n), 0))::integer, (sum(pw.p95::bigint * pw.n) / NULLIF(sum(pw.n), 0))::integer, max(pw.max)::integer, sum(pw.errors5xx)::bigint
    FROM public.perf_windows pw
   WHERE pw.at >= now() - make_interval(hours => GREATEST(1, LEAST(p_hours, 24 * 45)))
   GROUP BY pw.route, pw.method HAVING sum(pw.n) >= 5
   ORDER BY 5 DESC NULLS LAST LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

-- Opens and closes outages for the checks the one-minute probe measures. The probe calls this itself after writing its samples, so an outage of the APP is recorded even while the
-- app is dead (the app judges only the checks it measures itself). Same rule as lib/health/evaluate.ts decideIncident: open after p_after failed checks in a row (the newest
-- p_after samples of the last 15 minutes), close at the first good answer; one open incident per check at most.
CREATE OR REPLACE FUNCTION public.health_judge(p_keys text[], p_after integer DEFAULT 3)
RETURNS TABLE (check_key text, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text; newest boolean; fails integer; total integer; is_open boolean; bad_detail text;
BEGIN
  FOREACH k IN ARRAY p_keys LOOP
    SELECT hs.ok INTO newest FROM public.health_samples hs WHERE hs.check_key = k AND hs.at >= now() - interval '15 minutes' ORDER BY hs.at DESC LIMIT 1;
    CONTINUE WHEN newest IS NULL;
    SELECT EXISTS (SELECT 1 FROM public.health_incidents hi WHERE hi.check_key = k AND hi.ended_at IS NULL) INTO is_open;
    IF is_open THEN
      IF newest THEN
        UPDATE public.health_incidents hi SET ended_at = now() WHERE hi.check_key = k AND hi.ended_at IS NULL;
        check_key := k; action := 'close'; RETURN NEXT;
      ELSE
        UPDATE public.health_incidents hi SET failed_samples = hi.failed_samples + 1 WHERE hi.check_key = k AND hi.ended_at IS NULL;
      END IF;
    ELSE
      SELECT count(*) FILTER (WHERE NOT s.ok), count(*) INTO fails, total
        FROM (SELECT hs.ok FROM public.health_samples hs WHERE hs.check_key = k AND hs.at >= now() - interval '15 minutes' ORDER BY hs.at DESC LIMIT GREATEST(p_after, 1)) s;
      IF total >= GREATEST(p_after, 1) AND fails = total THEN
        SELECT hs.detail INTO bad_detail FROM public.health_samples hs WHERE hs.check_key = k AND NOT hs.ok ORDER BY hs.at DESC LIMIT 1;
        INSERT INTO public.health_incidents (check_key, detail, failed_samples) VALUES (k, bad_detail, GREATEST(p_after, 1)) ON CONFLICT DO NOTHING;
        check_key := k; action := 'open'; RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END $$;

-- Keeps the tables small: raw samples and speed windows for 45 days, closed incidents for 400 days. Called by the app once a day.
CREATE OR REPLACE FUNCTION public.health_prune()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; k integer;
BEGIN
  DELETE FROM public.health_samples WHERE at < now() - interval '45 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.perf_windows WHERE at < now() - interval '45 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.health_incidents WHERE ended_at IS NOT NULL AND ended_at < now() - interval '400 days'; GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.health_uptime(integer), public.health_series(text, integer, integer), public.health_daily(text, integer),
              public.perf_series(integer, integer), public.perf_slowest(integer, integer), public.health_prune(), public.health_judge(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_uptime(integer), public.health_series(text, integer, integer), public.health_daily(text, integer),
              public.perf_series(integer, integer), public.perf_slowest(integer, integer), public.health_prune(), public.health_judge(text[], integer) TO service_role;


-- ===== record the migration =====
DO $$ BEGIN
  INSERT INTO auth.schema_migrations (version) VALUES ('20240101000200') ON CONFLICT DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not record the version in auth.schema_migrations (no permission); the change itself was applied.';
END $$;

-- ===== check =====
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('health_samples','health_incidents','perf_windows','health_check_settings')) AS tables,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('health_uptime','health_series','health_daily','perf_series','perf_slowest','health_judge','health_prune')) AS functions,
       (SELECT count(*) FROM auth.schema_migrations WHERE version = '20240101000200') AS recorded;
'@
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  & $psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "Migration FAILED (exit $LASTEXITCODE). Nothing was applied - the database is unchanged. Backup is at $backupFile" }

  Write-Host "`n[3/3] Done. In the table above you should see: tables = 4, functions = 7, recorded = 1." -ForegroundColor Green
  Write-Host "Backup kept at: $backupFile"
  Write-Host "Next: restart the service CkDeskPostgrest on 10.0.1.98 once, then tell Claude 'migration 200 done'." -ForegroundColor Yellow
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item $sqlFile -ErrorAction SilentlyContinue
}
