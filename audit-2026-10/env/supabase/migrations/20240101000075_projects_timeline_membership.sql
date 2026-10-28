-- ============================================================
-- Projects — Phase C: timeline view support + cross-team membership
-- ============================================================
-- Timeline needs a date range per task — tasks.start_date already exists
-- (migration 064, added to pair with due_date for exactly this purpose) and
-- is nullable, so tasks with only a due date render as a single-day bar.
-- Nothing to add here for that part.

-- project_members: an explicit roster for projects that pull contributors
-- from outside the owning team — "who's on this," not a visibility gate.
-- Citykart Desk is single-tenant with org-wide SELECT on projects (migration
-- 073), so membership here doesn't need to widen RLS: everyone in the org can
-- already see every project. This table exists to answer "who's on this
-- project" (roster display, notification targeting) independent of team_id.
CREATE TABLE project_members (
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  added_by   UUID        NOT NULL REFERENCES profiles(id),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_members_user ON project_members(user_id);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_members_select" ON project_members FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "project_members_insert" ON project_members FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);
CREATE POLICY "project_members_delete" ON project_members FOR DELETE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);

GRANT ALL ON project_members TO service_role;
GRANT SELECT, INSERT, DELETE ON project_members TO authenticated;

-- alert_rules: allow a 'milestone' entity type for due-date alerts, reusing
-- the existing due_soon/overdue alert machinery (app/api/alerts/run).
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_entity_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_entity_type_check
  CHECK (entity_type IN ('request', 'task', 'milestone'));
