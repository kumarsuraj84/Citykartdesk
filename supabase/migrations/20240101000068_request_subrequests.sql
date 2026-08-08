-- Sub-requests: single-level self-reference, mirrors tasks.parent_task_id.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS parent_request_id UUID REFERENCES requests(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_requests_parent ON requests(parent_request_id);
