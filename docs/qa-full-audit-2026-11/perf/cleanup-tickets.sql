-- QA 2026-11 — removes exactly the synthetic load-test tickets from the DISPOSABLE audit database.
\set ON_ERROR_STOP on
SET session_replication_role = replica;
DELETE FROM requests WHERE request_no LIKE 'PERFLOAD-%';
ANALYZE requests;
SELECT count(*) AS requests_left, count(*) FILTER (WHERE request_no LIKE 'PERFLOAD-%') AS synthetic_left FROM requests;
