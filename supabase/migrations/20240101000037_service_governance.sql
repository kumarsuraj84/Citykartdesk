-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 037 — Phase 2: Service Governance
-- • escalation_policies table (org-scoped)
-- • services: owner_id, backup_owner_id, escalation_policy_id, visibility_scope
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Escalation policies ───────────────────────────────────────────────────────

CREATE TABLE escalation_policies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  -- rules: [{after_minutes: 60, action: 'notify_backup_owner' | 'notify_manager' | 'reassign_team_lead', notify_roles: ['manager']}]
  rules       JSONB       NOT NULL DEFAULT '[]',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_escalation_policies_org ON escalation_policies(org_id) WHERE is_active = true;

ALTER TABLE escalation_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "escalation_policies_select" ON escalation_policies FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "escalation_policies_insert" ON escalation_policies FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);
CREATE POLICY "escalation_policies_update" ON escalation_policies FOR UPDATE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);
CREATE POLICY "escalation_policies_delete" ON escalation_policies FOR DELETE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin', 'platform_owner')
);

GRANT ALL ON escalation_policies TO service_role;
GRANT SELECT ON escalation_policies TO authenticated;

-- 2. Add governance columns to services ───────────────────────────────────────

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS owner_id             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS backup_owner_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_policy_id UUID REFERENCES escalation_policies(id) ON DELETE SET NULL,
  -- visibility_scope: {audience: 'all' | 'agents_only' | 'specific_teams', team_ids: []}
  ADD COLUMN IF NOT EXISTS visibility_scope     JSONB NOT NULL DEFAULT '{"audience":"all"}';

CREATE INDEX IF NOT EXISTS idx_services_owner        ON services(owner_id)             WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_backup_owner ON services(backup_owner_id)      WHERE backup_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_escalation   ON services(escalation_policy_id) WHERE escalation_policy_id IS NOT NULL;

-- 3. updated_at triggers ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_escalation_policies_updated_at'
  ) THEN
    CREATE TRIGGER set_escalation_policies_updated_at
      BEFORE UPDATE ON escalation_policies
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;
