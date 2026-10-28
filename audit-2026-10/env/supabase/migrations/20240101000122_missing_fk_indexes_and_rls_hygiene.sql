-- Missing indexes on FK columns that are filtered directly (not just joined
-- from their own table's PK side) — "all notifications about request X",
-- "all activity/comments by user Y across every ticket", etc.
CREATE INDEX IF NOT EXISTS idx_approvals_workflow ON approvals(workflow_id);
CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications(actor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_request ON notifications(request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_task ON notifications(task_id);
CREATE INDEX IF NOT EXISTS idx_request_activity_actor ON request_activity(actor_id);
CREATE INDEX IF NOT EXISTS idx_request_comments_author ON request_comments(author_id);

-- request_sequences has RLS enabled but zero policies, which currently works
-- only "by accident": generate_request_no() is SECURITY DEFINER and so
-- bypasses RLS entirely as the function owner, and with no policy at all a
-- direct query from `authenticated`/`anon` is denied by default. Making that
-- explicit (rather than implicit-via-absence) so a future policy added here
-- for some other reason doesn't accidentally open it up.
CREATE POLICY "request_sequences_no_direct_access" ON request_sequences
  FOR ALL TO authenticated, anon
  USING (false);
