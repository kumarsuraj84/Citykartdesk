-- Outbound-email mailbox settings, editable from Admin > Platform Settings so the
-- mailbox address / password can be changed without editing server files.
--
-- Non-secret connection details (host, port, mailbox address) live in a
-- single-row table that ONLY the server (service_role) can read or write: RLS is
-- on with no policies and every grant to anon/authenticated is revoked. The
-- password is never stored in a table — it goes into the encrypted Vault
-- (same store the Intake channel credentials use), reachable only through the
-- three SECURITY DEFINER functions below, granted to service_role only.

CREATE TABLE email_smtp_settings (
  id          BOOLEAN     PRIMARY KEY DEFAULT true CHECK (id),  -- singleton row
  host        TEXT        NOT NULL,
  port        INTEGER     NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
  username    TEXT,
  updated_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_smtp_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_smtp_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON email_smtp_settings TO service_role;

-- ── Password in Vault ────────────────────────────────────────
-- Looked up by secret NAME so a stale/orphaned secret is reused, never duplicated.

CREATE OR REPLACE FUNCTION email_smtp_store_password(p_secret TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_secret IS NULL OR length(p_secret) = 0 THEN
    RAISE EXCEPTION 'password must not be empty';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'email_smtp_password';
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, p_secret, 'email_smtp_password', 'Outbound email mailbox password');
  ELSE
    v_id := vault.create_secret(p_secret, 'email_smtp_password', 'Outbound email mailbox password');
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION email_smtp_read_password()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_smtp_password'
$$;

CREATE OR REPLACE FUNCTION email_smtp_has_password()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_smtp_password')
$$;

CREATE OR REPLACE FUNCTION email_smtp_clear_password()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  DELETE FROM vault.secrets WHERE name = 'email_smtp_password'
$$;

REVOKE ALL ON FUNCTION email_smtp_store_password(TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION email_smtp_read_password()      FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION email_smtp_has_password()       FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION email_smtp_clear_password()     FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION email_smtp_store_password(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION email_smtp_read_password()      TO service_role;
GRANT EXECUTE ON FUNCTION email_smtp_has_password()       TO service_role;
GRANT EXECUTE ON FUNCTION email_smtp_clear_password()     TO service_role;

NOTIFY pgrst, 'reload schema';
