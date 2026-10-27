-- 182: outside temperature per city and day, for the AC Calendar on the Smart Dashboard. LOCAL ONLY until released ("push AC calendar one").
-- Rollback: supabase/rollback/182_weather_cache_rollback.sql
--
-- The temperatures come from the free public Open-Meteo service. Only a CITY NAME and STATE are ever sent to it (no tickets, no people, no company data). The answers are
-- kept here so each city is asked for each day only once. Server only: row security on, no right for the public, signed-in users or anonymous visitors.
BEGIN;

CREATE TABLE IF NOT EXISTS public.weather_city_geo (
  city         text NOT NULL,
  state        text NOT NULL DEFAULT '',
  lat          double precision,
  lon          double precision,
  place_name   text,
  geocoded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city, state)
);

CREATE TABLE IF NOT EXISTS public.weather_city_daily (
  city        text NOT NULL,
  state       text NOT NULL DEFAULT '',
  day         date NOT NULL,
  tmax        numeric(4,1),
  tmin        numeric(4,1),
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city, state, day)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['weather_city_geo', 'weather_city_daily'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

COMMIT;
