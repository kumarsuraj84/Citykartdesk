-- Closes a TOCTOU race in submitForApproval(): migration 031 dropped the plain
-- UNIQUE(request_id) constraint on `approvals` to allow multiple *sequential*
-- approval rounds per request, but never replaced it with anything narrower —
-- so two concurrent submitForApproval calls could both pass the app-level
-- "already pending?" check and insert two simultaneous pending approvals for
-- the same request. A request can still have any number of *resolved*
-- (approved/rejected) approval rows; this only forbids more than one *pending*
-- one at a time, which is the actual invariant the app relies on.
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_per_request
  ON approvals (request_id)
  WHERE status = 'pending';
