-- changePriority()/reclassifyRequest()/updateRequestCategory() each recompute
-- response_due_at/resolution_due_at from scratch (created_at + SLA duration
-- for the new priority/service/category), crediting only a pause that is
-- CURRENTLY active at the moment of the change. Any pause that had already
-- completed before this change — e.g. the ticket sat in waiting_user for two
-- days last week, resumed, and is now being reprioritised — was silently
-- discarded: the due date reset to a clock that never paused at all.
--
-- paused_ms_total is an exact, append-only ledger of every completed pause
-- (waiting_user or pending_approval, both marked via waiting_since) a
-- request has ever accumulated. Every SLA recompute-from-created_at path can
-- now add this ledger (plus any currently-active pause) on top of the fresh
-- baseline instead of relying on the stored due date having already baked
-- prior pauses in.
ALTER TABLE requests
  ADD COLUMN paused_ms_total BIGINT NOT NULL DEFAULT 0;
