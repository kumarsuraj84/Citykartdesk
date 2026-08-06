-- ── Admin configuration tables ────────────────────────────────────────────────

-- Global SLA configuration (default tiers — can be overridden per service)
CREATE TABLE IF NOT EXISTS global_sla_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  priority      TEXT NOT NULL UNIQUE CHECK (priority IN ('low','medium','high','urgent')),
  response_hours   NUMERIC(6,2),
  resolution_hours NUMERIC(6,2),
  escalation_pct   INTEGER NOT NULL DEFAULT 80, -- % of resolution SLA before escalation alert
  updated_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

GRANT ALL ON TABLE global_sla_config TO anon, authenticated, service_role;
ALTER TABLE global_sla_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_select" ON global_sla_config FOR SELECT USING (true);
CREATE POLICY "sla_write"  ON global_sla_config FOR ALL   USING (current_user_role() IN ('admin','manager'));

-- Seed defaults
INSERT INTO global_sla_config (priority, response_hours, resolution_hours, escalation_pct)
VALUES
  ('urgent',  0.25,  4,   80),
  ('high',    1,     8,   80),
  ('medium',  4,     24,  80),
  ('low',     8,     72,  80)
ON CONFLICT (priority) DO NOTHING;

-- ── Task template tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_template_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  default_priority TEXT NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low','medium','high','urgent')),
  due_offset_days INTEGER,            -- days after request creation
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

GRANT ALL ON TABLE task_templates       TO anon, authenticated, service_role;
GRANT ALL ON TABLE task_template_items  TO anon, authenticated, service_role;

ALTER TABLE task_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tmpl_select" ON task_templates      FOR SELECT USING (true);
CREATE POLICY "tmpl_write"  ON task_templates      FOR ALL    USING (current_user_role() IN ('admin','manager'));
CREATE POLICY "tmpl_item_select" ON task_template_items FOR SELECT USING (true);
CREATE POLICY "tmpl_item_write"  ON task_template_items FOR ALL    USING (current_user_role() IN ('admin','manager'));

CREATE INDEX idx_task_template_items_tmpl ON task_template_items(template_id, position);
