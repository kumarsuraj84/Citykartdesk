-- ============================================================
-- Intake Intelligence — Phase B: ingestion support
-- ============================================================
-- Adds:
--   1. Supabase Vault credential helpers (locked decision #3) so mailbox
--      credentials are encrypted at rest. Plaintext never touches intake_channels
--      or any Vercel/Railway env — only a Vault secret id (credentials_ref) is stored.
--   2. The private `intake-attachments` storage bucket (worker writes via
--      service-role; reviewers read via server-generated signed URLs).
--
-- The credential RPCs are SECURITY DEFINER and granted to service_role ONLY:
--   - The web app stores credentials via the admin (service-role) client.
--   - The worker reads them via the admin (service-role) client.
--   - `authenticated` can never read a decrypted secret.
--
-- Scope: CognixDesk only. HRMS untouched.
-- ============================================================

-- ── 0. Vault extension ───────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ── 1. Store/replace a channel's credentials in Vault ─────────
-- Returns the Vault secret id to persist in intake_channels.credentials_ref.
-- If the channel already has a credentials_ref, the existing secret is updated
-- in place (id preserved). The lookup is by Vault secret NAME (not the channel's
-- credentials_ref) so it recovers from any orphaned secret left by an earlier run.
CREATE OR REPLACE FUNCTION intake_store_credential(
  p_channel_id UUID,
  p_secret     TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_org       UUID;
  v_name      TEXT;
  v_secret_id UUID;
BEGIN
  SELECT org_id INTO v_org FROM intake_channels WHERE id = p_channel_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'channel % not found', p_channel_id;
  END IF;

  v_name := 'intake_channel_' || p_channel_id::text;

  -- Find any existing secret by name (handles the orphan case where a prior run
  -- created the secret but failed to persist credentials_ref on the channel).
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name;

  IF v_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_secret_id, p_secret, v_name, 'Intake channel credentials');
  ELSE
    v_secret_id := vault.create_secret(p_secret, v_name, 'Intake channel credentials');
  END IF;

  -- Always persist the secret id onto the channel so the worker can find it.
  UPDATE intake_channels SET credentials_ref = v_secret_id WHERE id = p_channel_id;
  RETURN v_secret_id;
END;
$$;

-- ── 2. Read a channel's decrypted credentials (worker only) ───
CREATE OR REPLACE FUNCTION intake_read_credential(p_ref UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = p_ref
$$;

-- ── 3. Lock the RPCs down to service_role only ───────────────
REVOKE ALL ON FUNCTION intake_store_credential(UUID, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION intake_read_credential(UUID)        FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION intake_store_credential(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION intake_read_credential(UUID)        TO service_role;

-- ── 4. Private intake-attachments bucket ─────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'intake-attachments',
  'intake-attachments',
  false,
  26214400,  -- 25MB, matches request-attachments + the table CHECK
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv',
    'application/octet-stream'  -- fallback for misc mail attachments
  ]
) ON CONFLICT (id) DO NOTHING;

-- Worker uploads/reads via the admin (service-role) client, which bypasses RLS.
-- These policies block direct authenticated raw access; reviewers get
-- server-generated signed URLs (same model as request-attachments).
CREATE POLICY "storage_intake_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'intake-attachments'
    AND EXISTS (
      SELECT 1 FROM intake_attachments ia
      WHERE ia.storage_path = name
        AND ia.org_id = current_org_id()
        AND current_user_role() IN ('agent','manager','admin','platform_owner')
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated → only service_role can write.
