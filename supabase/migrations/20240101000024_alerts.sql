CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('due_soon','overdue','unassigned','sla_warning','sla_breached','daily_digest')),
  entity_type TEXT NOT NULL DEFAULT 'request' CHECK (entity_type IN ('request','task')),
  threshold_minutes INT,
  notify_roles TEXT[] NOT NULL DEFAULT ARRAY['manager'],
  notify_assignee BOOLEAN NOT NULL DEFAULT true,
  notify_requester BOOLEAN NOT NULL DEFAULT false,
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app'],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_rules_select" ON alert_rules FOR SELECT USING (true);
CREATE POLICY "alert_rules_admin" ON alert_rules FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE alert_rules TO anon, authenticated, service_role;

INSERT INTO alert_rules (name, alert_type, entity_type, threshold_minutes, notify_roles, notify_assignee, channels) VALUES
  ('Task Due Soon (24h)', 'due_soon', 'task', 1440, ARRAY['manager'], true, ARRAY['in_app','email']),
  ('Task Overdue', 'overdue', 'task', 0, ARRAY['manager'], true, ARRAY['in_app','email']),
  ('Unassigned Request (2h)', 'unassigned', 'request', 120, ARRAY['manager'], false, ARRAY['in_app']),
  ('Daily Digest', 'daily_digest', 'request', NULL, ARRAY['manager','admin'], false, ARRAY['email']);

GRANT ALL ON TABLE alert_rules TO anon, authenticated, service_role;
