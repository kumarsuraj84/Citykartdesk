-- Intake Tier-1 efficiency flags
-- (1) Review-level: star (personal bookmark) + escalation (needs senior decision)
-- (2) Message-level: recipient_type — was the intake inbox directly TO'd or CC'd?

-- ── 1. intake_reviews flags ───────────────────────────────────────────────────
ALTER TABLE intake_reviews
  ADD COLUMN is_starred      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_escalated    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN escalation_note TEXT;

-- ── 2. intake_messages recipient context ─────────────────────────────────────
-- Populated at ingestion time (poller has the channel credentials → user email).
-- Existing rows default to 'to' (safe: we can't retroactively determine CC status).
ALTER TABLE intake_messages
  ADD COLUMN recipient_type TEXT NOT NULL DEFAULT 'to'
    CHECK (recipient_type IN ('to', 'cc', 'bcc'));

-- ── 3. Performance indexes ────────────────────────────────────────────────────
CREATE INDEX idx_intake_reviews_starred
  ON intake_reviews (org_id, is_starred) WHERE is_starred;

CREATE INDEX idx_intake_reviews_escalated
  ON intake_reviews (org_id, is_escalated) WHERE is_escalated;

CREATE INDEX idx_intake_messages_recipient
  ON intake_messages (org_id, recipient_type) WHERE recipient_type <> 'to';
