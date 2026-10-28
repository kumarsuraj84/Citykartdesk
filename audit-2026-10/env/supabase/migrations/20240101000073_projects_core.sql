-- ============================================================
-- Projects — Phase A (2/2): core tables
-- ============================================================
-- A project is a container that requests/tasks can optionally attach to, so
-- work spanning more than one ticket has somewhere to roll up. Mirrors the
-- shape of `tasks` (org_id, team_id, owner/creator, status, activity log)
-- rather than inventing a new pattern.
-- ============================================================

CREATE TYPE project_status AS ENUM (
  'not_started', 'in_progress', 'blocked', 'done', 'cancelled'
);

CREATE TABLE projects (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  description  TEXT,
  status       project_status NOT NULL DEFAULT 'not_started',
  team_id      UUID        REFERENCES teams(id) ON DELETE SET NULL,
  owner_id     UUID        NOT NULL REFERENCES profiles(id),
  created_by   UUID        NOT NULL REFERENCES profiles(id),
  start_date   DATE,
  target_date  DATE,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_org_status ON projects(org_id, status) WHERE archived_at IS NULL;
CREATE INDEX idx_projects_team       ON projects(team_id);
CREATE INDEX idx_projects_owner      ON projects(owner_id);

-- Append-only audit log, same shape/posture as task_activity.
CREATE TABLE project_activity (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id   UUID        REFERENCES profiles(id),
  action     TEXT        NOT NULL, -- 'created' | 'status_changed' | 'archived'
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_activity_project ON project_activity(project_id, created_at DESC);

-- ── Link existing work items to a project (nullable — zero regression) ──────

ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_project    ON tasks(project_id)    WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_project ON requests(project_id) WHERE project_id IS NOT NULL;

-- ── updated_at trigger (reuse existing set_updated_at) ───────────────────────

CREATE TRIGGER set_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Org-scoped only (not team-restrictive) on SELECT, matching tasks_select's
-- posture, to avoid the RLS-recursion class of bug fixed in migrations
-- 009/042/045. Edit rights are narrower: owner or manager/admin.

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON projects FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "projects_insert" ON projects FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);
CREATE POLICY "projects_update" ON projects FOR UPDATE USING (
  org_id = current_org_id()
  AND (owner_id = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);

-- Append-only: only the admin (service-role) client writes project_activity,
-- same restrictive-insert-deny posture as task_activity.
CREATE POLICY "project_activity_select" ON project_activity FOR SELECT USING (
  org_id = current_org_id()
);

GRANT ALL ON projects, project_activity TO service_role;
GRANT SELECT, INSERT, UPDATE ON projects TO authenticated;
GRANT SELECT ON project_activity TO authenticated;
