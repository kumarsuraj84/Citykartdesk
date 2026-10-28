DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_frequency') THEN
    CREATE TYPE report_frequency AS ENUM ('daily','weekly','monthly');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_type_enum') THEN
    CREATE TYPE report_type_enum AS ENUM ('requests','tasks','approvals');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  report_type report_type_enum NOT NULL,
  frequency report_frequency NOT NULL DEFAULT 'weekly',
  recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  filters JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduled_reports_admin" ON scheduled_reports
  FOR ALL USING (current_user_role() IN ('admin','manager'));

GRANT ALL ON TABLE scheduled_reports TO anon, authenticated, service_role;
