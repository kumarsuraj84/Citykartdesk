-- Sprint 6: Notification Platform
-- 1. Extend notification_type enum
-- 2. Extend notifications table (actor_id, link, metadata, archived_at)
-- 3. Add notification_preferences table

-- ── 1. Extend notification_type enum ─────────────────────────────────────────
-- ADD VALUE is non-transactional; each runs as its own statement.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_created';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'internal_note_added';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_reassigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'collaborator_added';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'collaborator_removed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'approval_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'approval_rejected';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_auto_closed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_cancelled';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'priority_changed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'status_changed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'sla_warning';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'sla_breached';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'mentioned';

-- ── 2. Extend notifications table ────────────────────────────────────────────
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id    UUID       REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link        TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata    JSONB      NOT NULL DEFAULT '{}';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Covering index for the "active unread" query (bell count)
CREATE INDEX IF NOT EXISTS idx_notifications_active_unread
  ON notifications(user_id, created_at DESC)
  WHERE archived_at IS NULL AND read_at IS NULL;

-- ── 3. Ensure RLS is enabled with the right policies ─────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notifications' AND policyname = 'notifications_select'
  ) THEN
    CREATE POLICY "notifications_select" ON notifications
      FOR SELECT USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notifications' AND policyname = 'notifications_update'
  ) THEN
    CREATE POLICY "notifications_update" ON notifications
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
END;
$$;

-- ── 4. notification_preferences ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, event_type)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prefs_select" ON notification_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "prefs_insert" ON notification_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "prefs_update" ON notification_preferences
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "prefs_delete" ON notification_preferences
  FOR DELETE USING (user_id = auth.uid());
