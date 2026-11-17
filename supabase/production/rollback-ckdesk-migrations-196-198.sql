-- ROLLBACK of migrations 196-198 (run as postgres on database ckdesk). Only needed if the new feature must be removed; no ticket is touched.
BEGIN;
DROP TABLE IF EXISTS public.zoho_transfer_runs, public.zoho_transfers, public.zoho_map_values, public.zoho_map_fields, public.zoho_map_people, public.zoho_map_items, public.zoho_map_categories, public.zoho_map_services, public.zoho_map_templates;
-- the ticket-number trigger as migration 156 left it
CREATE OR REPLACE FUNCTION public.trg_assign_request_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.request_no := generate_request_no();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_assign_request_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_assign_request_no() TO service_role;
COMMIT;
