-- Error reports submitted from CognixDesk app
CREATE TABLE error_reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  user_id      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  app          TEXT        NOT NULL DEFAULT 'cognixdesk',
  error_type   TEXT        NOT NULL,  -- 'crash' | 'error' | 'feedback'
  message      TEXT        NOT NULL,
  stack        TEXT,
  url          TEXT,
  metadata     JSONB       DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'new', -- 'new' | 'triaged' | 'resolved' | 'dismissed'
  owner_note   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can insert (submit errors)
CREATE POLICY "error_reports_insert" ON error_reports FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only platform_owner/admin can read
CREATE POLICY "error_reports_select" ON error_reports FOR SELECT
  USING (current_user_role() IN ('admin', 'platform_owner'));

CREATE INDEX idx_error_reports_status ON error_reports(status, created_at DESC);
CREATE INDEX idx_error_reports_org ON error_reports(org_id, created_at DESC);
