-- ============================================================
-- Migration _033: Complete Org Isolation
-- Adds org_id to all core tables + tightens RLS so every
-- tenant sees only their own data.
-- ============================================================

-- ── Helper: current user's org ────────────────────────────────

CREATE OR REPLACE FUNCTION current_org_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$;

-- ── 1. Add org_id columns ─────────────────────────────────────

ALTER TABLE requests            ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE tasks               ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE services            ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE service_categories  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE approval_workflows  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE departments         ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE locations           ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE cost_centers        ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE assignment_rules    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE alert_rules         ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE tags                ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE scheduled_reports   ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE global_sla_config   ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE task_templates      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- ── 2. Backfill ───────────────────────────────────────────────

-- requests: derive from the requester's org (most reliable)
UPDATE requests
SET org_id = (SELECT org_id FROM profiles WHERE id = requester_id)
WHERE org_id IS NULL;

-- tasks: derive from creator's org
UPDATE tasks
SET org_id = (SELECT org_id FROM profiles WHERE id = created_by)
WHERE org_id IS NULL;

-- everything else: default org
UPDATE services           SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE service_categories SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE approval_workflows SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE departments        SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE locations          SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE cost_centers       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE assignment_rules   SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE alert_rules        SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE tags               SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE scheduled_reports  SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE global_sla_config  SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE task_templates     SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- ── 3. Performance indexes ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_requests_org           ON requests(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org              ON tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_services_org           ON services(org_id);
CREATE INDEX IF NOT EXISTS idx_service_categories_org ON service_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_departments_org        ON departments(org_id);
CREATE INDEX IF NOT EXISTS idx_locations_org          ON locations(org_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_org       ON cost_centers(org_id);
CREATE INDEX IF NOT EXISTS idx_assignment_rules_org   ON assignment_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_org        ON alert_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_tags_org               ON tags(org_id);

-- ── 4. Owner org marker ───────────────────────────────────────

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;
UPDATE organizations SET is_owner = true WHERE id = '00000000-0000-0000-0000-000000000001';

CREATE OR REPLACE FUNCTION is_owner_org()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN organizations o ON o.id = p.org_id
    WHERE p.id = auth.uid()
      AND o.is_owner = true
      AND p.role = 'admin'
  )
$$;

-- ── 5. Fix profiles RLS (was USING (true) — cross-org leak) ───

DO $$
BEGIN
  -- Drop all existing broad-read policies on profiles
  DROP POLICY IF EXISTS "profiles_select"     ON profiles;
  DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
  DROP POLICY IF EXISTS "Users can read own profile" ON profiles;

  -- Org-scoped: only see profiles in your org + always your own row
  CREATE POLICY "profiles_select" ON profiles
    FOR SELECT USING (
      org_id = current_org_id()
      OR id = auth.uid()
    );
END;
$$;

-- ── 6. Fix requests RLS ───────────────────────────────────────

DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  org_id = current_org_id()
  AND (
    requester_id = auth.uid()
    OR is_team_member(team_id)
    OR current_user_role() IN ('manager','admin')
    OR EXISTS (
      SELECT 1 FROM request_collaborators rc
      WHERE rc.request_id = id AND rc.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "requests_insert" ON requests;
CREATE POLICY "requests_insert" ON requests FOR INSERT WITH CHECK (
  requester_id = auth.uid()
  AND org_id = current_org_id()
);

-- ── 7. Fix tasks RLS ──────────────────────────────────────────

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT USING (
  org_id = current_org_id()
  AND (
    created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR (task_type = 'team' AND is_team_member(team_id))
    OR current_user_role() IN ('manager','admin')
  )
);

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND created_by = auth.uid()
);

-- ── 8. Fix services RLS ───────────────────────────────────────

DROP POLICY IF EXISTS "services_select" ON services;
DROP POLICY IF EXISTS "services_admin"  ON services;
CREATE POLICY "services_select" ON services FOR SELECT USING (
  org_id = current_org_id()
  AND (is_active = true OR current_user_role() IN ('admin','manager'))
);
CREATE POLICY "services_admin" ON services FOR ALL USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin','manager')
);

-- ── 9. Fix service_categories RLS ────────────────────────────

DROP POLICY IF EXISTS "categories_select" ON service_categories;
DROP POLICY IF EXISTS "categories_admin"  ON service_categories;
CREATE POLICY "categories_select" ON service_categories FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "categories_admin"  ON service_categories FOR ALL USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

-- ── 10. Fix departments / locations / cost_centers RLS ────────

DROP POLICY IF EXISTS "dept_select" ON departments;
DROP POLICY IF EXISTS "dept_admin"  ON departments;
CREATE POLICY "dept_select" ON departments FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "dept_admin"  ON departments FOR ALL   USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager'));

DROP POLICY IF EXISTS "loc_select" ON locations;
DROP POLICY IF EXISTS "loc_admin"  ON locations;
CREATE POLICY "loc_select" ON locations FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "loc_admin"  ON locations FOR ALL   USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager'));

DROP POLICY IF EXISTS "cc_select" ON cost_centers;
DROP POLICY IF EXISTS "cc_admin"  ON cost_centers;
CREATE POLICY "cc_select" ON cost_centers FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "cc_admin"  ON cost_centers FOR ALL   USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager'));

-- ── 11. Fix approval_workflows RLS ───────────────────────────

DROP POLICY IF EXISTS "workflows_select" ON approval_workflows;
DROP POLICY IF EXISTS "workflows_admin"  ON approval_workflows;
CREATE POLICY "workflows_select" ON approval_workflows FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "workflows_admin"  ON approval_workflows FOR ALL   USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

-- ── 12. Fix assignment_rules RLS ─────────────────────────────

DROP POLICY IF EXISTS "rules_select" ON assignment_rules;
DROP POLICY IF EXISTS "rules_admin"  ON assignment_rules;
CREATE POLICY "rules_select" ON assignment_rules FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "rules_admin"  ON assignment_rules FOR ALL   USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

-- ── 13. Fix alert_rules RLS ───────────────────────────────────

DROP POLICY IF EXISTS "alert_rules_select" ON alert_rules;
DROP POLICY IF EXISTS "alert_rules_admin"  ON alert_rules;
CREATE POLICY "alert_rules_select" ON alert_rules FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "alert_rules_admin"  ON alert_rules FOR ALL   USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

-- ── 14. Fix tags RLS ──────────────────────────────────────────

DROP POLICY IF EXISTS "tags_select" ON tags;
DROP POLICY IF EXISTS "tags_admin"  ON tags;
CREATE POLICY "tags_select" ON tags FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "tags_admin"  ON tags FOR ALL   USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

-- ── 15. Fix scheduled_reports RLS ────────────────────────────

DROP POLICY IF EXISTS "scheduled_reports_select" ON scheduled_reports;
DROP POLICY IF EXISTS "scheduled_reports_admin"  ON scheduled_reports;
CREATE POLICY "scheduled_reports_select" ON scheduled_reports FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "scheduled_reports_admin"  ON scheduled_reports FOR ALL   USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

-- ── 16. Fix global_sla_config + task_templates RLS ───────────

DROP POLICY IF EXISTS "sla_config_select" ON global_sla_config;
DROP POLICY IF EXISTS "sla_config_admin"  ON global_sla_config;
CREATE POLICY "sla_config_select" ON global_sla_config FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "sla_config_admin"  ON global_sla_config FOR ALL   USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

DROP POLICY IF EXISTS "task_templates_select" ON task_templates;
DROP POLICY IF EXISTS "task_templates_admin"  ON task_templates;
CREATE POLICY "task_templates_select" ON task_templates FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "task_templates_admin"  ON task_templates FOR ALL   USING (
  org_id = current_org_id() AND current_user_role() IN ('admin','manager')
);

-- ── 17. Owner portal: read all orgs + write module access ─────

-- Allow own-org read (was already in _032) + owner-org read-all
DROP POLICY IF EXISTS "org_select"       ON organizations;
DROP POLICY IF EXISTS "org_owner_select" ON organizations;
DROP POLICY IF EXISTS "org_owner_write"  ON organizations;
CREATE POLICY "org_select"       ON organizations FOR SELECT USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR is_owner_org()
);
CREATE POLICY "org_owner_write"  ON organizations FOR ALL    USING (is_owner_org());

DROP POLICY IF EXISTS "org_module_access_select" ON org_module_access;
DROP POLICY IF EXISTS "org_module_access_write"  ON org_module_access;
CREATE POLICY "org_module_access_select" ON org_module_access FOR SELECT USING (
  org_id = current_org_id() OR is_owner_org()
);
CREATE POLICY "org_module_access_write"  ON org_module_access FOR ALL USING (is_owner_org());

DROP POLICY IF EXISTS "license_keys_none"  ON license_keys;
DROP POLICY IF EXISTS "license_keys_owner" ON license_keys;
CREATE POLICY "license_keys_owner" ON license_keys FOR ALL USING (is_owner_org());

DROP POLICY IF EXISTS "owner_audit_none"   ON owner_audit_log;
DROP POLICY IF EXISTS "owner_audit_read"   ON owner_audit_log;
DROP POLICY IF EXISTS "owner_audit_insert" ON owner_audit_log;
CREATE POLICY "owner_audit_read"   ON owner_audit_log FOR SELECT USING (is_owner_org());
CREATE POLICY "owner_audit_insert" ON owner_audit_log FOR INSERT WITH CHECK (is_owner_org());

-- ── 18. Triggers: auto-populate org_id on insert (handles seed + legacy rows) ─

CREATE OR REPLACE FUNCTION set_request_org_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := (SELECT org_id FROM profiles WHERE id = NEW.requester_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_request_org_id ON requests;
CREATE TRIGGER trg_request_org_id
  BEFORE INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION set_request_org_id();

CREATE OR REPLACE FUNCTION set_task_org_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := (SELECT org_id FROM profiles WHERE id = NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_org_id ON tasks;
CREATE TRIGGER trg_task_org_id
  BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_task_org_id();
