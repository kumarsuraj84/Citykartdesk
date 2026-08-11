-- Auto time-tracking (added this session) can race: two near-simultaneous
-- transitions into in_progress for the same user+request (double-click, two
-- open tabs, a retried request) can both read "no open entry" before either
-- writes, producing two open request_time_entries rows that both get closed
-- together later — double-counting tracked time. A partial unique index makes
-- the second concurrent INSERT fail fast (23505) instead of silently
-- succeeding twice; the caller treats that as "already started" and no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_open_per_user
  ON request_time_entries (request_id, user_id)
  WHERE stopped_at IS NULL;
