-- ============================================================
-- Intake Intelligence — Phase A (2/2): core tables, indexes, RLS, seed
-- ============================================================
-- Decision §3.0 (locked): public schema with `intake_` prefix (no dedicated
-- schema). All tables carry org_id NOT NULL + RLS USING (org_id = current_org_id()).
--
-- Phase A creates the capture-side foundation (channels, threads, messages,
-- attachments) plus the append-only audit log. Reviews/classifications/rules/
-- feedback arrive in Phases C–F.
--
-- Worker writes via the service-role key (bypasses RLS) and always sets org_id
-- explicitly from the channel's org. Authenticated users get RLS-scoped SELECT;
-- only admins manage channels. Messages/threads/attachments are worker-written,
-- so authenticated users get SELECT only.
--
-- Reuses existing SECURITY DEFINER helpers: current_org_id(), current_user_role(),
-- is_team_member(). Scope: Citykart Desk only. HRMS untouched.
-- ============================================================

-- ── 1. Enums ─────────────────────────────────────────────────

CREATE TYPE intake_channel_type AS ENUM (
  'email', 'portal', 'whatsapp', 'teams', 'slack', 'api'
);

CREATE TYPE intake_channel_status AS ENUM (
  'active', 'paused', 'error'
);

CREATE TYPE intake_thread_status AS ENUM (
  'open', 'linked', 'closed'
);

CREATE TYPE intake_message_status AS ENUM (
  'new', 'normalized', 'classified', 'in_review', 'actioned', 'rejected', 'duplicate'
);

-- ── 2. intake_channels ───────────────────────────────────────
-- A configured ingestion source. Credentials are never stored in plaintext —
-- `credentials_ref` holds a Supabase Vault secret id (wired in Phase B).

CREATE TABLE intake_channels (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID                  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            intake_channel_type   NOT NULL,
  name            TEXT                  NOT NULL,
  provider        TEXT,                 -- 'imap' | 'm365' | 'gmail' | null (non-email)
  config          JSONB                 NOT NULL DEFAULT '{}',  -- host/folder/poll interval/etc.
  credentials_ref TEXT,                 -- Vault secret id; never plaintext
  status          intake_channel_status NOT NULL DEFAULT 'paused',
  last_polled_at  TIMESTAMPTZ,
  last_error      TEXT,
  default_team_id UUID                  REFERENCES teams(id) ON DELETE SET NULL,
  created_by      UUID                  REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  UNIQUE (org_id, type, name)
);

-- ── 3. intake_threads ────────────────────────────────────────
-- Conversation grouping keyed by the provider's thread/conversation id.

CREATE TABLE intake_threads (
  id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID                 NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id          UUID                 NOT NULL REFERENCES intake_channels(id) ON DELETE CASCADE,
  external_thread_key TEXT,               -- provider thread/conversation id
  subject             TEXT,
  participant_emails  TEXT[]               NOT NULL DEFAULT '{}',
  message_count       INTEGER              NOT NULL DEFAULT 0,
  status              intake_thread_status NOT NULL DEFAULT 'open',
  first_message_at    TIMESTAMPTZ,
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ          NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ          NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel_id, external_thread_key)
);

-- ── 4. intake_messages ───────────────────────────────────────
-- One inbound communication (immutable raw capture). Unique external id per
-- channel makes re-polling idempotent.

CREATE TABLE intake_messages (
  id                  UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID                  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id          UUID                  NOT NULL REFERENCES intake_channels(id) ON DELETE CASCADE,
  thread_id           UUID                  REFERENCES intake_threads(id) ON DELETE SET NULL,
  external_message_id TEXT,                 -- provider id, for idempotency
  direction           TEXT                  NOT NULL DEFAULT 'inbound',
  from_address        TEXT,
  to_addresses        TEXT[]                NOT NULL DEFAULT '{}',
  cc_addresses        TEXT[]                NOT NULL DEFAULT '{}',
  subject             TEXT,
  body_text           TEXT,
  body_html           TEXT,
  headers             JSONB                 NOT NULL DEFAULT '{}',
  received_at         TIMESTAMPTZ,
  normalized          JSONB,                -- cleaned text, stripped signature/quote
  status              intake_message_status NOT NULL DEFAULT 'new',
  dedup_hash          TEXT,
  created_at          TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ           NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel_id, external_message_id)
);

-- ── 5. intake_attachments ────────────────────────────────────
-- Private bucket `intake-attachments` (created in a later dashboard/storage step).

CREATE TABLE intake_attachments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id   UUID        NOT NULL REFERENCES intake_messages(id) ON DELETE CASCADE,
  file_name    TEXT        NOT NULL,
  file_size    BIGINT      NOT NULL CHECK (file_size >= 0 AND file_size <= 26214400), -- ≤25MB
  mime_type    TEXT,
  storage_path TEXT        UNIQUE,
  scan_status  TEXT        NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 6. intake_audit_log ──────────────────────────────────────
-- Append-only. Written only via service-role (worker / server actions using the
-- admin client). INSERT is denied to `authenticated` via a RESTRICTIVE policy,
-- mirroring request_activity.

CREATE TABLE intake_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES profiles(id) ON DELETE SET NULL,  -- null = system/worker
  entity_type TEXT        NOT NULL,
  entity_id   UUID,
  action      TEXT        NOT NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 7. Indexes (§3.3 — designed up front) ────────────────────

CREATE INDEX idx_intake_channels_org           ON intake_channels (org_id, status);
CREATE INDEX idx_intake_threads_org_channel    ON intake_threads (org_id, channel_id);
CREATE INDEX idx_intake_messages_org_status    ON intake_messages (org_id, status, received_at DESC);
CREATE INDEX idx_intake_messages_thread        ON intake_messages (thread_id);
CREATE INDEX idx_intake_messages_dedup         ON intake_messages (dedup_hash) WHERE dedup_hash IS NOT NULL;
CREATE INDEX idx_intake_messages_subject_trgm  ON intake_messages USING gin (subject gin_trgm_ops) WHERE subject IS NOT NULL;
CREATE INDEX idx_intake_attachments_message    ON intake_attachments (message_id);
CREATE INDEX idx_intake_audit_org_created      ON intake_audit_log (org_id, created_at DESC);
CREATE INDEX idx_intake_audit_entity           ON intake_audit_log (entity_type, entity_id);

-- ── 8. Row Level Security ────────────────────────────────────

ALTER TABLE intake_channels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_threads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_audit_log   ENABLE ROW LEVEL SECURITY;

-- Channels: org members with an intake role can view; only admins manage.
-- (intake.view ≈ agent+; intake.manage_channels ≈ admin — enforced in app too.)
CREATE POLICY intake_channels_select ON intake_channels FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

CREATE POLICY intake_channels_insert ON intake_channels FOR INSERT
  WITH CHECK (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  );

CREATE POLICY intake_channels_update ON intake_channels FOR UPDATE
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  )
  WITH CHECK (org_id = current_org_id());

CREATE POLICY intake_channels_delete ON intake_channels FOR DELETE
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  );

-- Threads / messages / attachments: worker-written (service-role bypasses RLS).
-- Authenticated reviewers get org-scoped SELECT only.
CREATE POLICY intake_threads_select ON intake_threads FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

CREATE POLICY intake_messages_select ON intake_messages FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

CREATE POLICY intake_attachments_select ON intake_attachments FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

-- Audit log: managers/admins read org-scoped; INSERT denied to authenticated
-- (service-role only), mirroring request_activity.
CREATE POLICY intake_audit_select ON intake_audit_log FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('manager', 'admin', 'platform_owner')
  );

CREATE POLICY intake_audit_no_insert ON intake_audit_log AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

-- ── 9. Grants (RLS still applies; service-role bypasses RLS) ──

GRANT SELECT, INSERT, UPDATE, DELETE ON intake_channels    TO authenticated;
GRANT SELECT                         ON intake_threads     TO authenticated;
GRANT SELECT                         ON intake_messages    TO authenticated;
GRANT SELECT                         ON intake_attachments TO authenticated;
GRANT SELECT                         ON intake_audit_log   TO authenticated;

-- ── 10. updated_at triggers (reuse existing set_updated_at) ───

CREATE TRIGGER set_intake_channels_updated_at
  BEFORE UPDATE ON intake_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_intake_threads_updated_at
  BEFORE UPDATE ON intake_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_intake_messages_updated_at
  BEFORE UPDATE ON intake_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 11. Seed module access (disabled by default — dark launch) ─
-- 'intake' was added to module_slug in migration 052 (separate migration, as
-- required). Every existing org gets a disabled row so the module is invisible
-- until an owner explicitly enables it.

INSERT INTO org_module_access (org_id, module, enabled)
SELECT id, 'intake', false FROM organizations
ON CONFLICT (org_id, module) DO NOTHING;
