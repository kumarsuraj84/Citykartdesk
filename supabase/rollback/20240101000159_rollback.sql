-- ROLLBACK for migration 159 (ticket-number overflow). Restores the previous function, which repeats a ticket number after 999,999. LOCAL; NOT run on production.

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
