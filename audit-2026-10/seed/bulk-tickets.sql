-- CKDESK audit — adds synthetic tickets (plus 1 activity row each) to the disposable audit DB only. Usage: psql -v n=100000 -f -
\set ON_ERROR_STOP on
CREATE TEMP TABLE _agents AS SELECT tm.team_id, array_agg(tm.user_id) ids FROM team_members tm JOIN profiles p ON p.id = tm.user_id AND p.role = 'agent' GROUP BY tm.team_id;
CREATE TEMP TABLE _req AS SELECT array_agg(p.id) ids FROM profiles p JOIN auth.users u ON u.id = p.id WHERE u.email ~ '^(store|staff)[0-9]+@audit.test$';
CREATE TEMP TABLE _svc AS SELECT s.id, s.team_id, row_number() OVER (ORDER BY s.slug) rn, count(*) OVER () cnt FROM services s WHERE s.org_id = '00000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE _cat AS SELECT array_agg(id) ids FROM service_categories;
CREATE TEMP TABLE _sub AS SELECT array_agg(id) ids FROM service_sub_categories;
INSERT INTO requests (title, description, requester_id, assigned_to, service_id, team_id, priority, status, created_at, updated_at, resolved_at, closed_at, org_id, category_id, sub_category_id, form_data, request_no)
SELECT 'Perf ticket ' || g, 'Synthetic perf body ' || g, r.rid, CASE WHEN r.st IN ('open','pending_approval') THEN NULL ELSE a.ids[1 + floor(random()*cardinality(a.ids))::int] END,
  r.sid, r.tid, r.pr::request_priority, r.st::request_status, r.ca, r.ca + interval '2 hours',
  CASE WHEN r.st IN ('resolved','closed') THEN r.ca + (random()*interval '9 days') END, CASE WHEN r.st='closed' THEN r.ca + interval '10 days' END,
  '00000000-0000-0000-0000-000000000001', (SELECT ids[1+floor(random()*cardinality(ids))::int] FROM _cat), (SELECT ids[1+floor(random()*cardinality(ids))::int] FROM _sub), '{}'::jsonb, 'TMP'
FROM (SELECT g, (SELECT ids[1+floor(random()*cardinality(ids))::int] FROM _req) rid, s.id sid, s.team_id tid,
  (ARRAY['low','medium','medium','high','urgent'])[1+floor(random()*5)::int] pr,
  (ARRAY['open','open','assigned','in_progress','in_progress','in_progress','waiting_user','hold_purchase_ho','pending_approval','resolved','resolved','resolved','closed','closed','closed','closed','closed','closed','closed','cancelled'])[1+floor(random()*20)::int] st,
  now() - (random()*interval '730 days') ca
 FROM generate_series(1, :n) g JOIN _svc s ON s.rn = 1 + (g % (SELECT max(cnt) FROM _svc))) r LEFT JOIN _agents a ON a.team_id = r.tid;
ANALYZE requests;
SELECT count(*) AS requests_total FROM requests;
