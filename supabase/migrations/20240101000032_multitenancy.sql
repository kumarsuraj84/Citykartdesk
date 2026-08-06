-- ============================================================
-- Sprint: Multi-tenancy — Organizations + Module Access
-- ============================================================
-- Strategy: additive only. Existing tables get an org_id FK.
-- Existing data is backfilled to a default "FlowDesk" org.
-- RLS on new tables only; existing RLS unchanged for now.
-- ============================================================

-- ── 1. Enums ─────────────────────────────────────────────────

CREATE TYPE org_status AS ENUM ('trial', 'active', 'suspended', 'cancelled');

CREATE TYPE module_slug AS ENUM (
  'requests',
  'tasks',
  'approvals',
  'services',
  'time_tracking',
  'analytics',
  'integrations'
);

-- ── 2. organizations ─────────────────────────────────────────

CREATE TABLE organizations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  slug           TEXT        NOT NULL UNIQUE,
  status         org_status  NOT NULL DEFAULT 'trial',
  seat_limit     INTEGER     NOT NULL DEFAULT 10,
  trial_ends_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. org_module_access ─────────────────────────────────────

CREATE TABLE org_module_access (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module       module_slug NOT NULL,
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  seat_limit   INTEGER,                       -- null = inherit org limit
  valid_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until  TIMESTAMPTZ,                   -- null = perpetual
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, module)
);

CREATE INDEX idx_org_module_access_org ON org_module_access(org_id);

-- ── 4. license_keys ──────────────────────────────────────────

CREATE TABLE license_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_hash    TEXT        NOT NULL UNIQUE,   -- HMAC-SHA256 of the raw key
  modules     module_slug[] NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  notes       TEXT
);

-- ── 5. owner_audit_log ───────────────────────────────────────

CREATE TABLE owner_audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  org_id     UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_owner_audit_org ON owner_audit_log(org_id, created_at DESC);

-- ── 6. Add org_id to profiles + teams ────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE teams    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

CREATE INDEX idx_profiles_org ON profiles(org_id);
CREATE INDEX idx_teams_org    ON teams(org_id);

-- ── 7. Seed the default "owner" org for existing data ────────

INSERT INTO organizations (id, name, slug, status, seat_limit, trial_ends_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'FlowDesk',
  'flowdesk',
  'active',
  9999,
  NULL
);

-- Enable ALL modules for the default org (owner org sees everything)
INSERT INTO org_module_access (org_id, module, enabled, valid_until)
SELECT
  '00000000-0000-0000-0000-000000000001',
  unnest(ARRAY[
    'requests','tasks','approvals','services',
    'time_tracking','analytics','integrations'
  ]::module_slug[]),
  true,
  NULL;

-- Backfill all existing profiles + teams to the default org
UPDATE profiles SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE teams    SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- ── 8. RLS on new tables ─────────────────────────────────────

ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_module_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_audit_log    ENABLE ROW LEVEL SECURITY;

-- organizations: every authenticated user can read their own org
CREATE POLICY "org_select" ON organizations FOR SELECT USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- org_module_access: same — users can read their org's module list
CREATE POLICY "org_module_select" ON organizations FOR SELECT USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);

CREATE POLICY "org_module_access_select" ON org_module_access FOR SELECT USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- license_keys + owner_audit: owner-only (no tenant user access)
-- The owner portal uses the service-role admin client, so these policies
-- intentionally block all regular authenticated access.
CREATE POLICY "license_keys_none" ON license_keys FOR ALL USING (false);
CREATE POLICY "owner_audit_none"  ON owner_audit_log FOR ALL USING (false);

-- ── 9. Grants (Supabase: authenticated role needs SELECT on new tables) ──────

GRANT SELECT ON organizations     TO authenticated, anon;
GRANT SELECT ON org_module_access TO authenticated, anon;
-- license_keys + owner_audit_log are visible to authenticated (RLS deny policies block access anyway)
GRANT SELECT ON license_keys      TO authenticated;
GRANT SELECT ON owner_audit_log   TO authenticated;

-- ── 10. Helper: get enabled modules for the current user's org ───────────────

CREATE OR REPLACE FUNCTION get_enabled_modules()
RETURNS module_slug[] AS $$
  SELECT array_agg(module)
  FROM   org_module_access
  WHERE  org_id  = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND  enabled = true
    AND  (valid_until IS NULL OR valid_until > now());
$$ LANGUAGE sql STABLE SECURITY DEFINER;
