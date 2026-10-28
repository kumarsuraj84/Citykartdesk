-- Add notification_type values that were already used by application code
-- (email templates, alert rules) but were never added to the enum, causing
-- notify() calls with these types to silently fail their DB insert.
-- ADD VALUE is non-transactional; each runs as its own statement.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_unassigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_completed';
