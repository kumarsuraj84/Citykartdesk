CREATE TABLE assignment_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  scope_type          TEXT NOT NULL CHECK (scope_type IN ('service','sub_category','category')),
  scope_id            UUID NOT NULL,
  strategy            TEXT NOT NULL DEFAULT 'direct' CHECK (strategy IN ('direct','round_robin','load_balanced')),
  assignee_ids        UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  priority_filter     TEXT CHECK (priority_filter IN ('critical','high','medium','low')),
  last_assigned_index INT NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_assignment_rules_scope ON assignment_rules(scope_type, scope_id) WHERE is_active = true;

ALTER TABLE assignment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rules_select" ON assignment_rules FOR SELECT USING (true);
CREATE POLICY "rules_admin"  ON assignment_rules FOR ALL   USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE assignment_rules TO anon, authenticated, service_role;
