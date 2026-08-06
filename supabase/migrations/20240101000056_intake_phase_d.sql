-- ── Intake Phase D: Work Creation ────────────────────────────────────────────
-- Bidirectional linkage between intake messages and created work items.
-- Runs after migration 055 (classification tables + intake_reviews stubs).

-- 1. Reverse links: work items carry the intake_message_id they were created from.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS intake_message_id UUID REFERENCES intake_messages(id) ON DELETE SET NULL;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS intake_message_id UUID REFERENCES intake_messages(id) ON DELETE SET NULL;

-- Provenance snapshot stored in the work item at creation time.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS source_metadata JSONB;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS source_metadata JSONB;

-- Sparse indexes for reverse lookups (only intake-created rows carry these values).
CREATE INDEX idx_requests_intake_message ON requests(intake_message_id) WHERE intake_message_id IS NOT NULL;
CREATE INDEX idx_tasks_intake_message    ON tasks(intake_message_id)    WHERE intake_message_id IS NOT NULL;

-- 2. FK constraints on the Phase D stub columns already present in intake_reviews.
--    These were plain UUIDs — now they enforce referential integrity.
ALTER TABLE intake_reviews
  ADD CONSTRAINT fk_intake_reviews_created_request  FOREIGN KEY (created_request_id)  REFERENCES requests(id)  ON DELETE SET NULL,
  ADD CONSTRAINT fk_intake_reviews_created_task     FOREIGN KEY (created_task_id)     REFERENCES tasks(id)     ON DELETE SET NULL,
  ADD CONSTRAINT fk_intake_reviews_created_approval FOREIGN KEY (created_approval_id) REFERENCES approvals(id) ON DELETE SET NULL;
