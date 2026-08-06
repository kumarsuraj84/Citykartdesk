CREATE TABLE business_hours (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), start_time TIME NOT NULL DEFAULT '09:00', end_time TIME NOT NULL DEFAULT '17:00', is_active BOOLEAN NOT NULL DEFAULT true, UNIQUE (day_of_week));
INSERT INTO business_hours (day_of_week, start_time, end_time, is_active) VALUES (0,'09:00','17:00',false),(1,'09:00','17:00',true),(2,'09:00','17:00',true),(3,'09:00','17:00',true),(4,'09:00','17:00',true),(5,'09:00','17:00',true),(6,'09:00','17:00',false);
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "biz_hours_select" ON business_hours FOR SELECT USING (true);
CREATE POLICY "biz_hours_all" ON business_hours FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE business_hours TO anon, authenticated, service_role;

CREATE TABLE holidays (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, date DATE NOT NULL, is_recurring BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holidays_select" ON holidays FOR SELECT USING (true);
CREATE POLICY "holidays_all" ON holidays FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE holidays TO anon, authenticated, service_role;

CREATE TABLE sla_escalation_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, tier TEXT NOT NULL, trigger_pct SMALLINT NOT NULL DEFAULT 75 CHECK (trigger_pct BETWEEN 1 AND 100), notify_roles TEXT[] NOT NULL DEFAULT ARRAY['manager'], created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE sla_escalation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla_rules_select" ON sla_escalation_rules FOR SELECT USING (true);
CREATE POLICY "sla_rules_all" ON sla_escalation_rules FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE sla_escalation_rules TO anon, authenticated, service_role;
INSERT INTO sla_escalation_rules (name,tier,trigger_pct,notify_roles) VALUES ('Critical Warning','critical',75,ARRAY['manager','admin']),('High Warning','high',80,ARRAY['manager']),('Medium Warning','medium',85,ARRAY['manager']),('Low Warning','low',90,ARRAY['manager']);
