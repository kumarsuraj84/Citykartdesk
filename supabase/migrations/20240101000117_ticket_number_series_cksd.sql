-- Switches the ticket number series from "CK-0001" (4-digit) to
-- "CKSD-000001" (6-digit) ahead of the fresh-data push to the hosted project.
-- request_sequences is keyed by prefix, so the old 'CK' counter is left
-- alone (harmless, unused going forward) and a new 'CKSD' counter starts
-- from 1 the first time this function runs after deploy.
CREATE OR REPLACE FUNCTION public.generate_request_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_no INTEGER;
BEGIN
  INSERT INTO request_sequences (prefix, last_no)
    VALUES ('CKSD', 1)
  ON CONFLICT (prefix) DO UPDATE
    SET last_no = request_sequences.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN 'CKSD-' || LPAD(v_no::TEXT, 6, '0');
END;
$function$;
