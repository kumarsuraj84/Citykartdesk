CREATE TABLE org_signup_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  company_name TEXT        NOT NULL,
  company_size TEXT        NOT NULL,
  use_case     TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  rejection_reason TEXT,
  approved_org_id UUID     REFERENCES organizations(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public insert (no auth required — pre-signup)
CREATE POLICY "signup_requests_insert" ON org_signup_requests
  FOR INSERT WITH CHECK (true);

ALTER TABLE org_signup_requests ENABLE ROW LEVEL SECURITY;
