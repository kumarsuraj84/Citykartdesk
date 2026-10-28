-- ============================================================
-- Fix: generate_request_no must be SECURITY DEFINER so the
-- BEFORE INSERT trigger can write to request_sequences even
-- when RLS is enabled (authenticated users have no direct
-- policy on that table — the function owner does).
-- ============================================================

CREATE OR REPLACE FUNCTION generate_request_no(p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_no INTEGER;
BEGIN
  INSERT INTO request_sequences (prefix, last_no)
    VALUES (p_prefix, 1)
  ON CONFLICT (prefix) DO UPDATE
    SET last_no = request_sequences.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN p_prefix || '-' || LPAD(v_no::TEXT, 6, '0');
END;
$$;
