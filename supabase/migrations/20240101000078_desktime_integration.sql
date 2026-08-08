-- DeskTime integration: org-level API key, stored in Supabase Vault — never
-- in plaintext. Mirrors the intake_store_credential/intake_read_credential
-- pattern from migration 054 (vault extension already enabled there).

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS desktime_credential_ref uuid;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS desktime_connected_at timestamptz;

-- ── 1. Store/rotate the org's DeskTime API key (admin action only) ──────────
CREATE OR REPLACE FUNCTION org_store_desktime_key(
  p_org_id UUID,
  p_secret TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_name      TEXT;
  v_secret_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id;
  END IF;

  v_name := 'desktime_org_' || p_org_id::text;

  -- Find any existing secret by name (handles the orphan case where a prior
  -- run created the secret but failed to persist the ref).
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name;

  IF v_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_secret_id, p_secret, v_name, 'DeskTime API key');
  ELSE
    v_secret_id := vault.create_secret(p_secret, v_name, 'DeskTime API key');
  END IF;

  UPDATE organizations
  SET desktime_credential_ref = v_secret_id, desktime_connected_at = now()
  WHERE id = p_org_id;

  RETURN v_secret_id;
END;
$$;

-- ── 2. Read the decrypted key (service-role only — future sync jobs) ────────
CREATE OR REPLACE FUNCTION org_read_desktime_key(p_ref UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = p_ref
$$;

-- ── 3. Lock the RPCs down to service_role only ───────────────────────────────
REVOKE ALL ON FUNCTION org_store_desktime_key(UUID, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION org_read_desktime_key(UUID)        FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION org_store_desktime_key(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION org_read_desktime_key(UUID)        TO service_role;
