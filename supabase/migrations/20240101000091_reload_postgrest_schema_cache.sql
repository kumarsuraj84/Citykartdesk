-- PostgREST caches table-level GRANTs at connection-pool startup and only
-- picks up out-of-band privilege changes (like the previous migration's
-- GRANT INSERT/UPDATE/DELETE on services/service_categories) on its own
-- schedule. This forces an immediate reload so the fix takes effect now
-- instead of on next natural restart.
NOTIFY pgrst, 'reload schema';
