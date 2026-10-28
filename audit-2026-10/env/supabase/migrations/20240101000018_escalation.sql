CREATE TABLE IF NOT EXISTS sla_escalation_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE, rule_id UUID NOT NULL REFERENCES sla_escalation_rules(id) ON DELETE CASCADE, fired_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (request_id, rule_id));
ALTER TABLE sla_escalation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "esc_events_admin" ON sla_escalation_events FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE sla_escalation_events TO anon, authenticated, service_role;
