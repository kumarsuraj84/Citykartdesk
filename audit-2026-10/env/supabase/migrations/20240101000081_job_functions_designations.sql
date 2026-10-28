-- ============================================================
-- Job Functions + Designations — user-master classification
-- dimensions alongside the existing Department master data.
-- Same shape as locations/cost_centers, but RLS is written
-- org-scoped from day one (see migration 080's postmortem on why
-- USING(true) placeholder policies are dangerous to ever ship).
-- ============================================================

CREATE TABLE job_functions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  code       TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX idx_job_functions_org ON job_functions(org_id);

CREATE TABLE designations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  code       TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX idx_designations_org ON designations(org_id);

ALTER TABLE job_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE designations  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_functions_select" ON job_functions FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "job_functions_admin"  ON job_functions FOR ALL USING (
  org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner')
) WITH CHECK (
  org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);

CREATE POLICY "designations_select" ON designations FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "designations_admin"  ON designations FOR ALL USING (
  org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner')
) WITH CHECK (
  org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON job_functions, designations TO authenticated;
GRANT ALL ON job_functions, designations TO service_role;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS function_id    UUID REFERENCES job_functions(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS designation_id UUID REFERENCES designations(id)  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_function    ON profiles(function_id);
CREATE INDEX IF NOT EXISTS idx_profiles_designation ON profiles(designation_id);
