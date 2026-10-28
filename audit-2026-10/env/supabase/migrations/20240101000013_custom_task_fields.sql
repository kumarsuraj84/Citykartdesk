-- Custom field type enum
CREATE TYPE custom_field_type AS ENUM ('text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox');

-- Field definitions scoped to a team
CREATE TABLE task_custom_fields (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  field_type  custom_field_type NOT NULL DEFAULT 'text',
  options     JSONB,           -- [{value: string, color?: string}] for dropdown/multi_select
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Per-task values for each custom field
CREATE TABLE task_custom_field_values (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id    UUID NOT NULL REFERENCES task_custom_fields(id) ON DELETE CASCADE,
  value       JSONB,           -- string | number | boolean | string[] | null
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (task_id, field_id)
);

-- Indexes
CREATE INDEX idx_custom_fields_team   ON task_custom_fields(team_id, position);
CREATE INDEX idx_custom_field_values  ON task_custom_field_values(task_id);
CREATE INDEX idx_custom_field_values2 ON task_custom_field_values(field_id);

-- Grants (same pattern as task_activity and other tables)
GRANT ALL ON TABLE task_custom_fields       TO anon, authenticated, service_role;
GRANT ALL ON TABLE task_custom_field_values TO anon, authenticated, service_role;

-- RLS
ALTER TABLE task_custom_fields       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_custom_field_values ENABLE ROW LEVEL SECURITY;

-- Field definitions: team members can read; managers/admins can write
CREATE POLICY "custom_fields_select" ON task_custom_fields FOR SELECT USING (
  is_team_member(team_id) OR current_user_role() IN ('manager', 'admin')
);
CREATE POLICY "custom_fields_insert" ON task_custom_fields FOR INSERT WITH CHECK (
  current_user_role() IN ('manager', 'admin') OR is_team_member(team_id)
);
CREATE POLICY "custom_fields_update" ON task_custom_fields FOR UPDATE USING (
  current_user_role() IN ('manager', 'admin') OR created_by = auth.uid()
);
CREATE POLICY "custom_fields_delete" ON task_custom_fields FOR DELETE USING (
  current_user_role() IN ('manager', 'admin') OR created_by = auth.uid()
);

-- Field values: follow the task's visibility
CREATE POLICY "custom_field_values_select" ON task_custom_field_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid()
         OR current_user_role() IN ('manager', 'admin')))
);
CREATE POLICY "custom_field_values_upsert" ON task_custom_field_values FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid()
         OR current_user_role() IN ('manager', 'admin')))
);
CREATE POLICY "custom_field_values_update" ON task_custom_field_values FOR UPDATE USING (
  EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid()
         OR current_user_role() IN ('manager', 'admin')))
);
CREATE POLICY "custom_field_values_delete" ON task_custom_field_values FOR DELETE USING (
  EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id
    AND (t.created_by = auth.uid() OR t.assignee_id = auth.uid()
         OR current_user_role() IN ('manager', 'admin')))
);
