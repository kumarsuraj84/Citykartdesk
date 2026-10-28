-- ── Intake: add 'informational' work type ────────────────────────────────────
-- Most inbound mail is FYI/CC/notification — neither a request nor a task.
-- A distinct type lets the classifier stop forcing topical mail into 'request'.
ALTER TYPE intake_work_type ADD VALUE IF NOT EXISTS 'informational';
