CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_select" ON tags FOR SELECT USING (true);
CREATE POLICY "tags_admin" ON tags FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE tags TO anon, authenticated, service_role;

INSERT INTO tags (name, color) VALUES
  ('Bug','#ef4444'),('Feature Request','#3b82f6'),('Urgent','#f97316'),
  ('Hardware','#8b5cf6'),('Software','#06b6d4'),('HR','#ec4899'),
  ('Finance','#10b981'),('Facilities','#84cc16');

-- Request priority reference table (display config only — actual values stay in requests)
CREATE TABLE request_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  value TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  icon TEXT DEFAULT 'circle',
  display_order SMALLINT NOT NULL DEFAULT 0,
  sla_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  is_active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE request_priorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rp_select" ON request_priorities FOR SELECT USING (true);
CREATE POLICY "rp_admin" ON request_priorities FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE request_priorities TO anon, authenticated, service_role;

INSERT INTO request_priorities (name, value, color, display_order, sla_multiplier) VALUES
  ('Critical','critical','#ef4444',0,0.25),
  ('High','high','#f97316',1,0.50),
  ('Medium','medium','#eab308',2,1.00),
  ('Low','low','#22c55e',3,2.00);
