-- Rollback of 189. The data step added location ticks only; there is nothing to undo in the database for the old behaviour (the old app shows a service with every location ticked
-- to every requester at those locations, exactly as before). Run this only to forget that the migration ran, after the app of this release has been rolled back.
BEGIN;
DELETE FROM auth.schema_migrations WHERE version = '20240101000189';
COMMIT;
