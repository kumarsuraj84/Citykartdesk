-- Report Builder: save a field/filter/date-range configuration under a name and
-- re-run it anytime by picking it from a list, instead of rebuilding it from
-- scratch every time. Shared within the org (like a named report anyone can open),
-- not private to the creator — the creator (or a manager+) can still edit/delete it.

CREATE TABLE saved_reports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  entity     TEXT NOT NULL,
  -- The PivotBuilder's own state: mode, columns/rows/cols/values, filters,
  -- and the date-range field + either a relative preset (so "Today"/"Last 7
  -- days" stays fresh every time it's run) or an explicit from/to pair.
  config     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_reports_org ON saved_reports(org_id);

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_reports_select" ON saved_reports FOR SELECT
  USING (org_id = current_org_id());

CREATE POLICY "saved_reports_insert" ON saved_reports FOR INSERT
  WITH CHECK (org_id = current_org_id() AND created_by = auth.uid());

CREATE POLICY "saved_reports_update" ON saved_reports FOR UPDATE
  USING (
    org_id = current_org_id()
    AND (created_by = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  )
  WITH CHECK (org_id = (SELECT sr.org_id FROM saved_reports sr WHERE sr.id = saved_reports.id));

CREATE POLICY "saved_reports_delete" ON saved_reports FOR DELETE
  USING (
    org_id = current_org_id()
    AND (created_by = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  );

-- RLS policies alone are not enough — Postgres checks table-level GRANTs first,
-- before RLS is ever evaluated. Without this, every insert/update/delete/select
-- from the authenticated role is rejected at that first gate (same pattern as
-- form_field_library, the other table anyone signed-in reads/writes via RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports TO authenticated;
GRANT ALL ON saved_reports TO service_role;
