-- Rollback of 178 (vendor requests). Drops every parts / PO record; only do this when no vendor ticket is on hold for a request.
BEGIN;
DROP TABLE IF EXISTS public.vendor_request_items;
DROP TABLE IF EXISTS public.vendor_requests;
DELETE FROM auth.schema_migrations WHERE version = '20240101000178';
COMMIT;
