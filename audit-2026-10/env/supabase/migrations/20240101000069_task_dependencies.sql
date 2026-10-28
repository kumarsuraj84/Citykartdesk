-- Task dependencies: task_id "is blocked by" depends_on_task_id. Directional and
-- scoped to blocking relationships only (unlike related_requests' generic link_type)
-- because a cycle check only makes sense for a DAG of blockers.
CREATE TABLE task_dependencies (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id            UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by         UUID        NOT NULL REFERENCES profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX idx_task_deps_task       ON task_dependencies(task_id);
CREATE INDEX idx_task_deps_depends_on ON task_dependencies(depends_on_task_id);
CREATE INDEX idx_task_deps_org        ON task_dependencies(org_id);

ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_deps_select" ON task_dependencies FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "task_deps_insert" ON task_dependencies FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);
CREATE POLICY "task_deps_delete" ON task_dependencies FOR DELETE USING (
  org_id = current_org_id()
  AND (created_by = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);

GRANT ALL ON task_dependencies TO service_role;
GRANT SELECT, INSERT, DELETE ON task_dependencies TO authenticated;
