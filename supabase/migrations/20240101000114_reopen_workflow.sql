-- Reopen workflow for two specific terminal-state cases:
--   1. A request cancelled because an approval was REJECTED — the requester
--      (not the technician) may reopen it within a fixed window, since an
--      approval rejection can be an honest mistake. Reopening puts it back
--      with the same technician as 'assigned' (they must Start Working again
--      before resending for approval).
--   2. A request the requester is unsatisfied with after it was RESOLVED —
--      they may reopen it (with a mandatory remark) within a fixed window.
-- Any OTHER cancellation (a technician directly cancelling/rejecting a
-- ticket) is permanent — cancellation_reason distinguishes the two so the
-- app can tell them apart; only 'approval_rejected' is ever reopenable.
--
-- reopen_deadline_at is the single source of truth for both the "can this
-- still be reopened right now" check and the auto-close sweep that finalizes
-- it once the window lapses — set on resolve/approval-reject, cleared on
-- reopen or once auto-closed.

ALTER TABLE requests
  ADD COLUMN cancellation_reason TEXT CHECK (cancellation_reason IN ('approval_rejected', 'manual')),
  ADD COLUMN reopen_deadline_at TIMESTAMPTZ,
  ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0;
