CREATE TABLE task_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  value TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  display_order SMALLINT NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE task_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ts_select" ON task_statuses FOR SELECT USING (true);
CREATE POLICY "ts_admin" ON task_statuses FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE task_statuses TO anon, authenticated, service_role;

INSERT INTO task_statuses (name, value, color, display_order, is_terminal) VALUES
  ('To Do','todo','#6b7280',0,false),
  ('In Progress','in_progress','#3b82f6',1,false),
  ('Blocked','blocked','#ef4444',2,false),
  ('Done','done','#22c55e',3,true),
  ('Cancelled','cancelled','#9ca3af',4,true);

CREATE TABLE task_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  value TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  display_order SMALLINT NOT NULL DEFAULT 0,
  icon TEXT DEFAULT 'circle',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE task_priorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tp_select" ON task_priorities FOR SELECT USING (true);
CREATE POLICY "tp_admin" ON task_priorities FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE task_priorities TO anon, authenticated, service_role;

INSERT INTO task_priorities (name, value, color, display_order) VALUES
  ('Critical','critical','#ef4444',0),
  ('High','high','#f97316',1),
  ('Medium','medium','#eab308',2),
  ('Low','low','#22c55e',3);
