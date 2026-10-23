-- LOCAL TESTING ONLY: removes the demo AC tickets made by seed-ac-calendar-demo.sql.
BEGIN;
DELETE FROM request_master_snapshots WHERE request_id IN (SELECT id FROM requests WHERE title LIKE 'DEMOCAL%');
DELETE FROM request_activity WHERE request_id IN (SELECT id FROM requests WHERE title LIKE 'DEMOCAL%');
DELETE FROM requests WHERE title LIKE 'DEMOCAL%';
COMMIT;
