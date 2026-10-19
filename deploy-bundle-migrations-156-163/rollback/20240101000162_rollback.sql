-- ROLLBACK for migration 162: drops the unique index (the ordinary index from migration 056 stays). LOCAL; NOT run on production.
DROP INDEX IF EXISTS public.requests_one_per_intake_message;
