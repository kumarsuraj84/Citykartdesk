-- CSAT: remember when the one reminder e-mail was sent, so a requester is never reminded twice.
-- (Run by the database admin: csat_surveys is owned by postgres.)
ALTER TABLE csat_surveys ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- The reminder job looks for unrated surveys that are old enough and not yet reminded.
CREATE INDEX IF NOT EXISTS idx_csat_pending_reminder ON csat_surveys (sent_at) WHERE submitted_at IS NULL AND reminder_sent_at IS NULL;
