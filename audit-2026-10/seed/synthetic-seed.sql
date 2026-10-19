-- CKDesk audit — SYNTHETIC dataset for the disposable audit database ONLY (supabase_db_ckdesk_audit).
-- No production or dev-stack data is read or copied; every name/email is generated (@audit.test).
-- Usage:  docker exec -i supabase_db_ckdesk_audit psql -U postgres -d postgres -v n_tickets=3000 -v ON_ERROR_STOP=1 -f - < synthetic-seed.sql
-- Logins (all roles): <email> / Audit-Pw-1!   e.g. admin1@audit.test, manager1@audit.test, agent1@audit.test, store1@audit.test, staff1@audit.test
\set ON_ERROR_STOP on
\if :{?n_tickets}
\else
\set n_tickets 3000
\endif
\set org '''00000000-0000-0000-0000-000000000001'''
BEGIN;
SET LOCAL session_replication_role = 'origin';

-- ── structure ────────────────────────────────────────────────────────────────
INSERT INTO departments (name, org_id, code) VALUES
  ('Administration', :org, 'ADM'), ('Business Development', :org, 'BD'), ('IT', :org, 'IT'), ('Human Resources', :org, 'HR'), ('Finance', :org, 'FIN');

INSERT INTO teams (name, slug, prefix, department_id, org_id)
SELECT t.name, t.slug, t.prefix, d.id, :org
FROM (VALUES ('ADMIN GROUP','admin-group','ADMN','ADM'), ('BD GROUP','bd-group','BDG','BD'), ('IT SUPPORT','it-support','ITS','IT'),
             ('HR SUPPORT','hr-support','HRS','HR'), ('FINANCE SUPPORT','finance-support','FNS','FIN')) t(name, slug, prefix, dep)
JOIN departments d ON d.code = t.dep AND d.org_id = :org;

INSERT INTO services (name, slug, team_id, org_id, default_priority, is_active, status, visibility)
SELECT s.name, s.slug, t.id, :org, 'medium', true, 'published', 'all'
FROM (VALUES
 ('ADMIN GROUP','ADMIN - AC','admin-ac'), ('ADMIN GROUP','ADMIN REPAIR','admin-repair'), ('ADMIN GROUP','ADMIN - REQUIREMENTS (NON TRADING)','admin-requirements'), ('ADMIN GROUP','ADMIN GENERAL','admin-general'),
 ('BD GROUP','BD LAYOUT','bd-layout'), ('BD GROUP','BD LEGAL','bd-legal'),
 ('IT SUPPORT','Laptop issue','it-laptop'), ('IT SUPPORT','Software access','it-software'), ('IT SUPPORT','Network','it-network'),
 ('HR SUPPORT','Payroll query','hr-payroll'), ('HR SUPPORT','Leave policy','hr-leave'),
 ('FINANCE SUPPORT','Invoice','fin-invoice'), ('FINANCE SUPPORT','Reimbursement','fin-reimb')) s(team, name, slug)
JOIN teams t ON t.name = s.team AND t.org_id = :org;

INSERT INTO service_categories (name, slug, org_id) VALUES ('Hardware','hardware', :org), ('Process','process', :org), ('Facilities','facilities', :org);
INSERT INTO service_sub_categories (category_id, name, slug, sla_priority)
SELECT c.id, x.name, x.slug, 'medium' FROM service_categories c
JOIN (VALUES ('hardware','Breakdown','breakdown'), ('hardware','Replacement','replacement'), ('process','Approval','approval'), ('process','Clarification','clarification'), ('facilities','Repair','repair'), ('facilities','New requirement','new-req')) x(cat, name, slug) ON x.cat = c.slug AND c.org_id = :org;

-- ── stores (200, synthetic) ──────────────────────────────────────────────────
INSERT INTO stores (org_id, code, name, city, state, cluster, region, priority_list, ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix, open_date, is_active)
SELECT :org, 'S' || lpad(g::text, 3, '0'), 'Audit Store ' || g,
  (ARRAY['Pune','Nagpur','Indore','Bhopal','Jaipur','Surat','Patna','Ranchi'])[1 + g % 8],
  (ARRAY['MH','MH','MP','MP','RJ','GJ','BR','JH'])[1 + g % 8],
  'C' || (1 + g % 10), (ARRAY['NORTH','SOUTH','EAST','WEST'])[1 + g % 4],
  (ARRAY['P1','P2','P3',NULL])[1 + g % 4], g % 26, (ARRAY['VOLTAS','CARRIER','HITACHI'])[1 + g % 3],
  (ARRAY['VOLTAS','CARRIER'])[1 + g % 2], 'AMC VENDOR ' || (1 + g % 4), (g % 3 = 0),
  CASE WHEN g % 5 = 0 THEN current_date - ((random() * 240)::int) ELSE current_date - (300 + (random() * 2000)::int) END, true
FROM generate_series(1, 200) g;

-- ── users: auth.users (the handle_new_user trigger creates the profile) ──────
CREATE TEMP TABLE _pw AS SELECT crypt('Audit-Pw-1!', gen_salt('bf')) AS h;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, (SELECT h FROM _pw), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(), '', '', '', ''
FROM (
  SELECT 'admin' || g || '@audit.test' AS email, 'Audit Admin ' || g AS name FROM generate_series(1, 3) g
  UNION ALL SELECT 'manager' || g || '@audit.test', 'Audit Manager ' || g FROM generate_series(1, 5) g
  UNION ALL SELECT 'agent' || g || '@audit.test', 'Audit Agent ' || g FROM generate_series(1, 20) g
  UNION ALL SELECT 'store' || g || '@audit.test', 'Audit Store Login ' || g FROM generate_series(1, 200) g
  UNION ALL SELECT 'staff' || g || '@audit.test', 'Audit Staff ' || g FROM generate_series(1, 100) g
) u;

UPDATE profiles p SET org_id = :org, is_active = true,
  role = CASE WHEN u.email LIKE 'admin%' THEN 'admin'::user_role WHEN u.email LIKE 'manager%' THEN 'manager' WHEN u.email LIKE 'agent%' THEN 'agent' ELSE 'user' END
FROM auth.users u WHERE u.id = p.id AND u.email LIKE '%@audit.test';

UPDATE profiles p SET store_id = s.id FROM auth.users u, stores s
WHERE u.id = p.id AND u.email ~ '^store[0-9]+@audit.test$' AND s.org_id = :org AND s.code = 'S' || lpad(substring(u.email from '^store([0-9]+)@')::int::text, 3, '0');

-- managers lead teams 1..5, agents are spread over the five teams (4 each)
INSERT INTO team_members (team_id, user_id, is_lead, org_id)
SELECT t.id, u.id, true, :org FROM (SELECT id, row_number() OVER (ORDER BY name) rn FROM teams WHERE org_id = :org) t
JOIN (SELECT u.id, substring(u.email from '^manager([0-9]+)@')::int rn FROM auth.users u WHERE u.email ~ '^manager[0-9]+@audit.test$') u ON u.rn = t.rn;
INSERT INTO team_members (team_id, user_id, is_lead, org_id)
SELECT t.id, u.id, false, :org FROM (SELECT id, row_number() OVER (ORDER BY name) rn FROM teams WHERE org_id = :org) t
JOIN (SELECT u.id, 1 + (substring(u.email from '^agent([0-9]+)@')::int - 1) % 5 rn FROM auth.users u WHERE u.email ~ '^agent[0-9]+@audit.test$') u ON u.rn = t.rn;

-- ── tickets ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _agents AS SELECT tm.team_id, array_agg(tm.user_id) ids FROM team_members tm JOIN profiles p ON p.id = tm.user_id AND p.role = 'agent' GROUP BY tm.team_id;
CREATE TEMP TABLE _req AS SELECT array_agg(p.id) ids FROM profiles p JOIN auth.users u ON u.id = p.id WHERE u.email ~ '^(store|staff)[0-9]+@audit.test$';
CREATE TEMP TABLE _svc AS SELECT s.id, s.team_id, row_number() OVER (ORDER BY s.slug) rn, count(*) OVER () cnt FROM services s WHERE s.org_id = :org;
CREATE TEMP TABLE _subcat AS SELECT array_agg(id) ids FROM service_sub_categories;
CREATE TEMP TABLE _cat AS SELECT array_agg(id) ids FROM service_categories WHERE org_id = :org;

INSERT INTO requests (title, description, requester_id, assigned_to, service_id, team_id, priority, status, created_at, updated_at, resolved_at, closed_at, org_id, category_id, sub_category_id, form_data, request_no)
SELECT 'Audit ticket ' || g, 'Synthetic ticket body ' || g, r.rid, CASE WHEN r.st IN ('open','pending_approval') THEN NULL ELSE a.ids[1 + floor(random() * cardinality(a.ids))::int] END,
  r.sid, r.tid, r.pr::request_priority, r.st::request_status, r.ca, r.ca + interval '2 hours',
  -- a ticket cannot be resolved/closed in the future (the first seed did, which made 17 recent tickets look still open to the time-based dashboard)
  CASE WHEN r.st IN ('resolved','closed') THEN least(r.ca + (random() * interval '9 days'), now()) END,
  CASE WHEN r.st = 'closed' THEN least(r.ca + interval '10 days', now()) END,
  :org, (SELECT ids[1 + floor(random() * cardinality(ids))::int] FROM _cat), (SELECT ids[1 + floor(random() * cardinality(ids))::int] FROM _subcat), '{}'::jsonb, 'TMP'
FROM (
  SELECT g, (SELECT ids[1 + floor(random() * cardinality(ids))::int] FROM _req) rid, s.id sid, s.team_id tid,
    (ARRAY['low','medium','medium','high','urgent'])[1 + floor(random() * 5)::int] pr,
    (ARRAY['open','open','open','assigned','in_progress','in_progress','in_progress','in_progress','waiting_user','hold_purchase_ho','pending_approval','resolved','resolved','resolved','resolved','closed','closed','closed','closed','closed','closed','cancelled'])[1 + floor(random() * 22)::int] st,
    now() - (random() * interval '365 days') ca
  FROM generate_series(1, :n_tickets) g JOIN _svc s ON s.rn = 1 + (g % (SELECT max(cnt) FROM _svc))
) r LEFT JOIN _agents a ON a.team_id = r.tid;

INSERT INTO request_activity (request_id, actor_id, action, metadata, created_at) SELECT id, requester_id, 'created', '{}'::jsonb, created_at FROM requests WHERE org_id = :org;
INSERT INTO request_comments (request_id, author_id, body, is_internal, created_at)
SELECT r.id, CASE WHEN k % 2 = 0 THEN r.requester_id ELSE r.assigned_to END, 'Synthetic comment ' || k, (k % 3 = 0), r.created_at + (k || ' hours')::interval
FROM requests r CROSS JOIN generate_series(1, 2) k WHERE r.org_id = :org AND r.assigned_to IS NOT NULL AND random() < 0.5;
COMMIT;
ANALYZE;
SELECT 'users' k, count(*) FROM auth.users UNION ALL SELECT 'profiles', count(*) FROM profiles UNION ALL SELECT 'teams', count(*) FROM teams UNION ALL SELECT 'services', count(*) FROM services
UNION ALL SELECT 'stores', count(*) FROM stores UNION ALL SELECT 'requests', count(*) FROM requests UNION ALL SELECT 'comments', count(*) FROM request_comments;
