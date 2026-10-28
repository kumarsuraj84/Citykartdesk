-- Unify request numbering into a single org-wide series instead of one
-- sequence per team prefix (IT-000021, HR-000003, ...). Every new request now
-- gets "CK-0001", "CK-0002", ... regardless of which team/service it's for.
-- teams.prefix is left in place (unused now, harmless) rather than dropped —
-- removing a column is a separate, higher-risk change than this rename.

-- CREATE OR REPLACE with a different parameter list creates a new overload
-- rather than replacing the old one — drop the old single-param version
-- explicitly so it doesn't linger as dead code.
DROP FUNCTION IF EXISTS generate_request_no(TEXT);

CREATE OR REPLACE FUNCTION generate_request_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_no INTEGER;
BEGIN
  INSERT INTO request_sequences (prefix, last_no)
    VALUES ('CK', 1)
  ON CONFLICT (prefix) DO UPDATE
    SET last_no = request_sequences.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN 'CK-' || LPAD(v_no::TEXT, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION trg_assign_request_no()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.request_no := generate_request_no();
  RETURN NEW;
END;
$$;

-- Reset the counter so the next request starts fresh at CK-0001.
DELETE FROM request_sequences;
