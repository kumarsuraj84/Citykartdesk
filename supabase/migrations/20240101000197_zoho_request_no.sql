-- 197: a ticket moved from Zoho keeps its Zoho number as `ZOHO-<the Zoho ticket number>` (stage 2 of the Zoho -> CK Desk transfer).
-- Until now the trigger ALWAYS replaced the number with the next generated one (migration 156 made it SECURITY DEFINER and closed direct calls to the generator).
-- It now keeps a number that is exactly ZOHO- and digits, but ONLY when the insert is not made by a signed-in user or the anonymous role (the server's key, an
-- administrator's SQL session). A person using the data API with their own token (role authenticated / anon) still always gets a generated number, so nobody can choose
-- or fake a ZOHO- number. (A signed-in user also has no INSERT right on requests at all - VAPT VA-DB-02 - so this is a second lock.) The column is already UNIQUE, so the
-- same Zoho number can never be used twice. Everything else is exactly as migration 156 left it.
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_assign_request_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- (inside a SECURITY DEFINER function current_user is the owner, so the caller's role is read from the session setting, which SET ROLE / PostgREST sets)
  IF coalesce(current_setting('role', true), '') NOT IN ('authenticated', 'anon') AND NEW.request_no ~ '^ZOHO-[0-9]{1,18}$' THEN
    RETURN NEW;
  END IF;
  NEW.request_no := generate_request_no();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_assign_request_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_assign_request_no() TO service_role;

COMMIT;
