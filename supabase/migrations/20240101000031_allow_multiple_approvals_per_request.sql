-- Allow multiple sequential approval rounds on a single request.
-- Previously the UNIQUE constraint on approvals.request_id prevented sending
-- ad-hoc approvals after a predefined workflow already ran.
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_request_id_key;

-- Also relax the UNIQUE constraint on approval_decisions (approval_id, step_order)
-- so that parallel-mode approvals with the same step_order per user work correctly.
-- (Each approver in parallel mode gets their own step_order 1..N, so this is fine.)
