CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  parent_id UUID REFERENCES departments(id),
  head_user_id UUID REFERENCES profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dept_select" ON departments FOR SELECT USING (true);
CREATE POLICY "dept_admin" ON departments FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE departments TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  country TEXT,
  city TEXT,
  timezone TEXT DEFAULT 'UTC',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "loc_select" ON locations FOR SELECT USING (true);
CREATE POLICY "loc_admin" ON locations FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE locations TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  department_id UUID REFERENCES departments(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cc_select" ON cost_centers FOR SELECT USING (true);
CREATE POLICY "cc_admin" ON cost_centers FOR ALL USING (current_user_role() IN ('admin','manager'));
GRANT ALL ON TABLE cost_centers TO anon, authenticated, service_role;

-- Add org fields to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES profiles(id);
