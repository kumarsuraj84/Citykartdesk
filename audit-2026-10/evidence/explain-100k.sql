\timing on
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"9d9c47a1-de46-4935-abf4-fb0d4c6fc5fd","role":"authenticated"}'; SET LOCAL statement_timeout = '60s';
\echo === manager org-wide recent 25 (no count) ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT id,request_no,title,status,priority,created_at,updated_at,resolution_due_at FROM requests ORDER BY updated_at DESC LIMIT 25;
\echo === manager count exact ===
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM requests;
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"b5aba815-6cae-4979-b565-427ccc353ead","role":"authenticated"}'; SET LOCAL statement_timeout = '60s';
\echo === technician queue (team filter, open statuses, order due) ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT id,request_no,title,status FROM requests WHERE team_id='d2f4a71a-5268-4f29-b5e3-4c89dbf34728' AND status IN ('open','assigned','in_progress','waiting_user') ORDER BY resolution_due_at ASC NULLS LAST LIMIT 25;
\echo === technician count exact ===
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM requests WHERE team_id='d2f4a71a-5268-4f29-b5e3-4c89dbf34728' AND status IN ('open','assigned','in_progress','waiting_user');
ROLLBACK;
\echo === same technician query as service role (RLS bypassed) for comparison ===
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM requests WHERE team_id='d2f4a71a-5268-4f29-b5e3-4c89dbf34728' AND status IN ('open','assigned','in_progress','waiting_user');
