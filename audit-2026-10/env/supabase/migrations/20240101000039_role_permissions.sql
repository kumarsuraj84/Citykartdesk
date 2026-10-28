-- ── Permission overrides per org ──────────────────────────────────────────────
-- Stores per-role, per-action permission state. Default (no row) = system default.
CREATE TABLE IF NOT EXISTS permission_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_key   TEXT NOT NULL,  -- 'user' | 'agent' | 'manager' | 'admin' | 'platform_owner' | custom role name
  action_key TEXT NOT NULL,  -- matches PERMISSION_MATRIX row keys
  allowed    BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE (org_id, role_key, action_key)
);

ALTER TABLE permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_overrides_select" ON permission_overrides FOR SELECT
  USING (org_id = current_org_id());

CREATE POLICY "perm_overrides_upsert" ON permission_overrides FOR INSERT
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin','platform_owner'));

CREATE POLICY "perm_overrides_update" ON permission_overrides FOR UPDATE
  USING (org_id = current_org_id() AND current_user_role() IN ('admin','platform_owner'));

CREATE POLICY "perm_overrides_delete" ON permission_overrides FOR DELETE
  USING (org_id = current_org_id() AND current_user_role() IN ('admin','platform_owner'));

-- ── Custom roles per org ──────────────────────────────────────────────────────
-- Named role profiles (extend system roles with custom names + permission sets)
CREATE TABLE IF NOT EXISTS custom_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  description TEXT,
  base_role  TEXT NOT NULL DEFAULT 'user', -- inherits defaults from this system role
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  UNIQUE (org_id, name)
);

ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_roles_select" ON custom_roles FOR SELECT
  USING (org_id = current_org_id());

CREATE POLICY "custom_roles_insert" ON custom_roles FOR INSERT
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin','platform_owner'));

CREATE POLICY "custom_roles_update" ON custom_roles FOR UPDATE
  USING (org_id = current_org_id() AND current_user_role() IN ('admin','platform_owner'));

CREATE POLICY "custom_roles_delete" ON custom_roles FOR DELETE
  USING (org_id = current_org_id() AND current_user_role() IN ('admin','platform_owner'));

GRANT ALL ON permission_overrides TO authenticated;
GRANT ALL ON custom_roles TO authenticated;
