-- ============================================================
-- Milestone alerts: notification_type values
-- ============================================================
-- New functionality (app/api/alerts/run milestone due_soon/overdue), so it
-- gets real enum values from day one rather than the legacy string-cast
-- workaround used by the pre-existing task_due_soon/task_overdue alerts
-- (see app/api/alerts/run/route.ts's asNotificationType() comment — those
-- predate the enum and are a known, separate gap, not fixed here).
-- ADD VALUE is non-transactional; each runs as its own statement.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'milestone_due_soon';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'milestone_overdue';
