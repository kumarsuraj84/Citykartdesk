CREATE TABLE retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('request','task','audit_log','notification','attachment')),
  retention_days INT NOT NULL DEFAULT 365,
  archive_after_days INT,
  purge_after_days INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "retention_select" ON retention_policies FOR SELECT USING (current_user_role() IN ('admin','manager'));
CREATE POLICY "retention_admin" ON retention_policies FOR ALL USING (current_user_role() = 'admin');
GRANT ALL ON TABLE retention_policies TO anon, authenticated, service_role;

INSERT INTO retention_policies (entity_type, retention_days, archive_after_days, purge_after_days) VALUES
  ('request', 1825, 365, NULL),
  ('task', 1825, 365, NULL),
  ('audit_log', 2555, NULL, 2555),
  ('notification', 90, NULL, 90),
  ('attachment', 1825, NULL, NULL);
