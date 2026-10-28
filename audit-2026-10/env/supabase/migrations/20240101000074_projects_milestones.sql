-- ============================================================
-- Projects — Phase B: milestones
-- ============================================================
-- A time-boxed slice of a project (start/end date both required — that's
-- what makes it "time-boxed" vs. the project's own optional dates).
-- Deliberately scoped to tasks only, not requests — milestones are a
-- work-planning concept; tickets stay project-level.
-- ============================================================

CREATE TABLE milestones (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID           NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT           NOT NULL,
  status       project_status NOT NULL DEFAULT 'not_started',
  start_date   DATE           NOT NULL,
  end_date     DATE           NOT NULL,
  sort_order   SMALLINT       NOT NULL DEFAULT 0,
  created_by   UUID           NOT NULL REFERENCES profiles(id),
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_milestones_project ON milestones(project_id, sort_order);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id) WHERE milestone_id IS NOT NULL;

CREATE TRIGGER set_milestones_updated_at
  BEFORE UPDATE ON milestones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS mirrors projects: org-scoped SELECT, narrower write rights.
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestones_select" ON milestones FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "milestones_insert" ON milestones FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);
CREATE POLICY "milestones_update" ON milestones FOR UPDATE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);
CREATE POLICY "milestones_delete" ON milestones FOR DELETE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);

GRANT ALL ON milestones TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON milestones TO authenticated;
