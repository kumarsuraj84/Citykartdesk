-- Round-robin `assign` actions need a persisted cursor per rule, same as
-- assignment_rules.last_assigned_index. Missed in migration 096's initial
-- schema — added here rather than editing the already-applied migration.
ALTER TABLE business_rules ADD COLUMN last_assigned_index INT NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
