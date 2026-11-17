-- QA 2026-11 — synthetic ticket volume for the DISPOSABLE audit database ONLY.   psql ... -v n=100000 -f gen-tickets.sql
-- Rows are marked request_no 'PERFLOAD-........' so cleanup-tickets.sql can remove exactly these. Triggers are bypassed (replica role) so no notification / log row is produced.
\set ON_ERROR_STOP on
SET session_replication_role = replica;
WITH u  AS (SELECT array_agg(id) a FROM profiles WHERE role = 'user'  AND vendor_company_id IS NULL AND org_id = '00000000-0000-0000-0000-000000000001'),
     ag AS (SELECT array_agg(id) a FROM profiles WHERE role = 'agent' AND org_id = '00000000-0000-0000-0000-000000000001'),
     sv AS (SELECT array_agg(id) a FROM services WHERE is_active AND org_id = '00000000-0000-0000-0000-000000000001'),
     tm AS (SELECT array_agg(id) a FROM teams WHERE org_id = '00000000-0000-0000-0000-000000000001'),
     base AS (SELECT COALESCE(max(substring(request_no from 'PERFLOAD-(\d+)')::int), 0) AS b FROM requests WHERE request_no LIKE 'PERFLOAD-%')
INSERT INTO requests (request_no, title, description, requester_id, assigned_to, service_id, team_id, priority, status, created_at, updated_at, org_id, resolved_at, closed_at, resolution_due_at, response_due_at)
SELECT 'PERFLOAD-' || lpad((base.b + g)::text, 9, '0'),
       'PERF load ticket ' || (base.b + g) || ' - AC not cooling at store ' || (g % 400),
       'Synthetic ticket for load testing. Store ' || (g % 400) || '. Please check the unit.',
       u.a[1 + (g % array_length(u.a, 1))],
       CASE WHEN st.s IN ('open') THEN NULL ELSE ag.a[1 + (g % array_length(ag.a, 1))] END,
       sv.a[1 + (g % array_length(sv.a, 1))],
       tm.a[1 + (g % array_length(tm.a, 1))],
       (ARRAY['low','medium','medium','high','urgent'])[1 + (g % 5)]::request_priority,
       st.s::request_status,
       ts.t, ts.t + interval '1 hour', '00000000-0000-0000-0000-000000000001',
       CASE WHEN st.s IN ('resolved','closed') THEN ts.t + interval '5 hours' END,
       CASE WHEN st.s = 'closed' THEN ts.t + interval '3 days' END,
       ts.t + interval '2 days', ts.t + interval '4 hours'
FROM generate_series(1::bigint, :n::bigint) g, u, ag, sv, tm, base,
     LATERAL (SELECT (ARRAY['open','assigned','in_progress','in_progress','waiting_user','resolved','resolved','closed','closed','closed','closed','cancelled'])[1 + (g % 12)] AS s) st,
     LATERAL (SELECT now() - ((g * 7919) % 1095) * interval '1 day' - ((g * 104729) % 86400) * interval '1 second' AS t) ts;
ANALYZE requests;
SELECT count(*) AS total_requests, count(*) FILTER (WHERE request_no LIKE 'PERFLOAD-%') AS synthetic FROM requests;
