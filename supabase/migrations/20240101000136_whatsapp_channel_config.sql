-- ============================================================
-- STAGE 5 — WhatsApp Cloud API channel configuration
-- ============================================================
-- Reuses the existing intake_channels table + Supabase Vault credential
-- architecture (see STAGE_5_REPORT.md "Meta Configuration Model" / "Secret
-- Storage") instead of introducing a second tenant-mapping system.
-- intake_channel_type already has a 'whatsapp' value (present since the
-- very first intake migration, never previously used).
--
-- A WhatsApp channel's row shape (no new columns needed):
--   type            = 'whatsapp'
--   config          = { phone_number_id, waba_id, display_name, api_version? }
--   credentials_ref = Vault secret id (via intake_store_credential), whose
--                     decrypted JSON is { access_token, app_secret, verify_token }
--
-- The one new invariant this stage needs at the DB level: a Meta
-- phone_number_id is globally unique to a single WhatsApp Business phone
-- number (issued by Meta, not scoped to a Citykart org), so it must never
-- resolve to two different channels/orgs. The entire inbound-webhook
-- tenant-isolation guarantee (Step 5: "Meta phone_number_id -> channel ->
-- org_id", never "sender mobile -> global lookup") depends on this being a
-- real constraint, not merely an application-level assumption.
CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_channels_whatsapp_phone_number_id
  ON intake_channels ((config ->> 'phone_number_id'))
  WHERE type = 'whatsapp' AND (config ->> 'phone_number_id') IS NOT NULL;
