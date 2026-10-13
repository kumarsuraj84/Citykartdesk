-- Post-audit remediation, ticket numbers (found while load-testing at 500,000 tickets; new defect D-069). LOCAL migration; NOT applied to production.
--
-- generate_request_no() padded the counter with LPAD(n::text, 6, '0'). LPAD also TRUNCATES: once the counter passed 999,999, the numbers
-- 1,000,000 and 1,000,001 both became 'CKSD-100000', the unique ticket-number rule rejected the second one, and no ticket could be created.
-- Fix: numbers up to 999,999 look exactly as before (CKSD-000123); larger ones are written in full (CKSD-1000000).
-- Existing tickets and the counter are untouched. Function permissions (service_role only, set by migration 156) are kept by CREATE OR REPLACE.

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

  RETURN 'CKSD-' || CASE WHEN v_no < 1000000 THEN LPAD(v_no::TEXT, 6, '0') ELSE v_no::TEXT END;
END;
$function$;
