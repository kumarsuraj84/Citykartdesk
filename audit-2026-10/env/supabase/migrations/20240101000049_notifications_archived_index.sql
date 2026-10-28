-- Notifications "archived" view index (perf-audit low-priority follow-up)
--
-- The /notifications "archived" filter queries (user_id, created_at DESC)
-- WHERE archived_at IS NOT NULL — the only notification view without a supporting
-- partial index. The other two views are already covered:
--   "all"    -> idx_notifications_user_unarchived  (WHERE archived_at IS NULL)
--   "unread" -> idx_notifications_active_unread     (WHERE archived_at IS NULL AND read_at IS NULL)
--
-- Scope: Citykart Desk-owned table only.

CREATE INDEX IF NOT EXISTS idx_notifications_user_archived
  ON notifications (user_id, created_at DESC)
  WHERE archived_at IS NOT NULL;
