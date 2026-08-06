-- Secondary performance indexes
--
-- approvals page fires 4 COUNT queries filtered by status on every load.
-- Only idx_approvals_request existed — no index on status column.

-- Covers: approvals page status tab counts (pending / approved / rejected / all)
CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals(status);

-- Covers: pending approval count in nav + dashboard (decided_by on approval_decisions)
CREATE INDEX IF NOT EXISTS idx_approval_decisions_decided_by
  ON approval_decisions(decided_by);
