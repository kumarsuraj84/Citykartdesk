-- ============================================================
-- Project Updates — narrative status log
-- ============================================================
-- Distinct from project_activity (system events: created/status_changed/
-- archived, admin-client-only insert). This is user-authored content: a
-- free-text "here's what happened, here's what's blocking us" post with a
-- self-reported progress snapshot. The snapshot is informational only — it
-- does not write back to the project's own (auto-computed, task/request-
-- rollup-derived) progress bar, so there is exactly one source of truth for
-- "actual" progress and this is a separate, human narrative alongside it.
-- ============================================================

CREATE TABLE project_updates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id        UUID        NOT NULL REFERENCES profiles(id),
  update_date      DATE        NOT NULL,
  update_text      TEXT        NOT NULL,
  percent_snapshot SMALLINT    NOT NULL DEFAULT 0 CHECK (percent_snapshot BETWEEN 0 AND 100),
  blockers         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_updates_project ON project_updates(project_id, update_date DESC, created_at DESC);

ALTER TABLE project_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_updates_select" ON project_updates FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "project_updates_insert" ON project_updates FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  AND author_id = auth.uid()
);
CREATE POLICY "project_updates_delete" ON project_updates FOR DELETE USING (
  org_id = current_org_id()
  AND (author_id = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);

GRANT ALL ON project_updates TO service_role;
GRANT SELECT, INSERT, DELETE ON project_updates TO authenticated;
