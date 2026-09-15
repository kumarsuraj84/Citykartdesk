-- Windows-compatible shim for Supabase Vault: same public interface
-- (vault.secrets, vault.decrypted_secrets, vault.create_secret, vault.update_secret)
-- backed by pgcrypto symmetric encryption instead of Supabase's proprietary
-- pgsodium-based backend, since neither pgsodium nor the real supabase_vault
-- extension ship for Windows Postgres.
CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON vault.secrets FROM PUBLIC;

CREATE VIEW vault.decrypted_secrets AS
SELECT
  id,
  name,
  description,
  public.pgp_sym_decrypt(secret, current_setting('app.vault_key')) AS decrypted_secret,
  created_at,
  updated_at
FROM vault.secrets;

REVOKE ALL ON vault.decrypted_secrets FROM PUBLIC;

CREATE FUNCTION vault.create_secret(
  new_secret text,
  new_name text DEFAULT NULL,
  new_description text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, pg_temp
AS $$
DECLARE
  rec_id uuid;
BEGIN
  INSERT INTO vault.secrets (name, description, secret)
  VALUES (new_name, coalesce(new_description, ''), public.pgp_sym_encrypt(new_secret, current_setting('app.vault_key')))
  RETURNING id INTO rec_id;
  RETURN rec_id;
END;
$$;

REVOKE ALL ON FUNCTION vault.create_secret(text, text, text) FROM PUBLIC;

CREATE FUNCTION vault.update_secret(
  secret_id uuid,
  new_secret text DEFAULT NULL,
  new_name text DEFAULT NULL,
  new_description text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, pg_temp
AS $$
BEGIN
  UPDATE vault.secrets SET
    secret = CASE WHEN new_secret IS NOT NULL THEN public.pgp_sym_encrypt(new_secret, current_setting('app.vault_key')) ELSE secret END,
    name = coalesce(new_name, name),
    description = coalesce(new_description, description),
    updated_at = now()
  WHERE id = secret_id;
END;
$$;

REVOKE ALL ON FUNCTION vault.update_secret(uuid, text, text, text) FROM PUBLIC;
