-- Search & list-sort performance indexes (perf audit H4, H5)
--
-- Scope: CognixDesk-owned tables only (requests, tasks). This database is the
-- dedicated CognixDesk Supabase project and contains no HRMS tables.
--
-- NOTE on M4 (approval_workflow_steps): intentionally NOT added. The table already
-- has UNIQUE (workflow_id, step_order) from the initial schema, which Postgres backs
-- with a btree index that already covers workflow_id lookups and the join in
-- getApprovalsForUser(). A separate index would be redundant write overhead.

-- pg_trgm is already enabled (migrations 000, 028); ensure for safety.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── H4: trigram indexes for description substring search ──────────────────────
-- lib/actions/search.ts runs `.ilike('description', '%term%')` on requests and tasks.
-- Only `title` had a trigram index; `description` matches were sequential scans.

CREATE INDEX IF NOT EXISTS idx_requests_description_trgm
  ON requests USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm
  ON tasks USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;

-- ── H5: composite indexes matching the actual list sorts ──────────────────────
-- getRequests view='mine': eq(requester_id) order(updated_at DESC), no status filter.
-- Existing idx_requests_requester / idx_requests_requester_status don't cover the sort.
CREATE INDEX IF NOT EXISTS idx_requests_requester_updated
  ON requests (requester_id, updated_at DESC);

-- getTasks filter='assigned_me'/'my_tasks': eq(assignee_id) order(created_at DESC),
-- no status filter (returns all statuses) — a partial index would be unusable here,
-- so this is a full composite. Existing idx_tasks_assignee_status covers (assignee_id,
-- status) but not the created_at sort.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_created
  ON tasks (assignee_id, created_at DESC);
