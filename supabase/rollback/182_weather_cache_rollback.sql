-- Rollback of 182 (weather cache). Only the saved temperatures are lost; they are fetched again when needed.
BEGIN;
DROP TABLE IF EXISTS public.weather_city_daily;
DROP TABLE IF EXISTS public.weather_city_geo;
DELETE FROM auth.schema_migrations WHERE version = '20240101000182';
COMMIT;
