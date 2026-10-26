-- LOCAL TEST ONLY. Removes the "[DEMO HISTORY]" requests made by seed-approval-history-demo.sql (the Qty tick on the template is left as it is).
BEGIN;
DELETE FROM approval_decisions WHERE approval_id IN (SELECT a.id FROM approvals a JOIN requests r ON r.id = a.request_id WHERE r.title LIKE '[DEMO HISTORY]%');
DELETE FROM approvals WHERE request_id IN (SELECT id FROM requests WHERE title LIKE '[DEMO HISTORY]%');
DELETE FROM approval_workflows WHERE name LIKE 'Ad-hoc approval DEMO HISTORY%';
DELETE FROM request_activity WHERE request_id IN (SELECT id FROM requests WHERE title LIKE '[DEMO HISTORY]%');
DELETE FROM requests WHERE title LIKE '[DEMO HISTORY]%';
COMMIT;
