-- Same bug class as migration 070: app/api/alerts/run/route.ts inserts notifications
-- with these three types, but they were never added to the notification_type enum,
-- so notify()'s DB insert has been silently failing for task-due-soon, task-overdue,
-- and daily-digest alerts (route reports non-zero success counts regardless).
-- ADD VALUE is non-transactional; each runs as its own statement.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_due_soon';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_overdue';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'daily_digest';
