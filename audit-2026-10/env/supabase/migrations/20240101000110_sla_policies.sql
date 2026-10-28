-- SLA Policies: reusable named SLA tables (e.g. "IT SLA"), mapped 1:1 to a
-- Service (many services may reuse the same policy). Replaces the inline
-- services.sla_config override. Sub-Category no longer stores its own hours
-- (added last migration, unused in practice) — it now carries just a single
-- priority label, looked up against whichever service's policy applies.

CREATE TABLE sla_policies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sla_policies_org ON sla_policies(org_id);
CREATE INDEX idx_sla_policies_active ON sla_policies(org_id) WHERE is_active = true;

CREATE TRIGGER set_sla_policies_updated_at
  BEFORE UPDATE ON sla_policies
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_policies_select" ON sla_policies FOR SELECT USING (
  org_id = current_org_id()
  AND (is_active = true OR current_user_role() IN ('admin','manager','platform_owner'))
);
CREATE POLICY "sla_policies_admin" ON sla_policies FOR ALL USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin','manager','platform_owner')
);

GRANT SELECT ON sla_policies TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON sla_policies TO authenticated;
GRANT ALL ON sla_policies TO service_role;

-- Service maps to exactly one policy.
ALTER TABLE services ADD COLUMN sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL;
CREATE INDEX idx_services_sla_policy ON services(sla_policy_id) WHERE sla_policy_id IS NOT NULL;
ALTER TABLE services DROP COLUMN sla_config;

-- Sub-Category carries only a priority label.
ALTER TABLE service_sub_categories ADD COLUMN sla_priority request_priority;
ALTER TABLE service_sub_categories DROP COLUMN sla_config;

NOTIFY pgrst, 'reload schema';
