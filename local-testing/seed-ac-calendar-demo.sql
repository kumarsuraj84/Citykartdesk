-- LOCAL TESTING ONLY. Demo AC tickets so the AC Calendar of the Smart Dashboard has something to show: the store PAR (Pakur, 7 ACs) has one AC that keeps failing (AC 2),
-- one on watch (AC 5) and a few single faults; the store COB (Cooch Behar) has a few faults too. All titles start with "DEMOCAL" (remove them with seed-ac-calendar-demo-cleanup.sql).
-- Run: docker exec -i supabase_db_citykart_desk psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < local-testing/seed-ac-calendar-demo.sql
BEGIN;

DELETE FROM request_master_snapshots WHERE request_id IN (SELECT id FROM requests WHERE title LIKE 'DEMOCAL%');
DELETE FROM requests WHERE title LIKE 'DEMOCAL%';

DO $$
DECLARE
  org uuid := '00000000-0000-0000-0000-000000000001';
  svc uuid := (SELECT id FROM services WHERE auto_oem_routing LIMIT 1);
  team uuid := (SELECT t.id FROM teams t WHERE t.org_id = org AND t.name = 'ADMIN GROUP' LIMIT 1);
  cat uuid := (SELECT id FROM service_categories WHERE org_id = org AND auto_oem_kind = 'ac' LIMIT 1);
  r record;
  rid uuid;
  unit record;
  requester uuid;
BEGIN
  -- (store, AC number, days ago raised, days until fixed or NULL = still open)
  FOR r IN SELECT * FROM (VALUES
    ('PAR', '2', 80, 2), ('PAR', '2', 61, 1), ('PAR', '2', 40, 2), ('PAR', '2', 21, 1), ('PAR', '2', 9, 3), ('PAR', '2', 1, NULL),
    ('PAR', '5', 48, 2), ('PAR', '5', 20, 4), ('PAR', '5', 3, NULL),
    ('PAR', '1', 33, 1), ('PAR', '3', 17, 2), ('PAR', '4', 12, 1), ('PAR', '6', 6, 2), ('PAR', '8', 4, 1),
    ('COB', '1', 25, 3), ('COB', '1', 7, 2), ('COB', '3', 14, 2), ('COB', '4', 2, NULL), ('COB', '6', 5, 1),
    ('ALC', '1', 10, 2), ('ALC', '2', 3, NULL)
  ) AS t(store, ac, raised, fixed) LOOP
    SELECT u.* INTO unit FROM master_ac_units u WHERE u.store_code = r.store AND u.ckdesk_no = r.ac AND u.removed_at IS NULL LIMIT 1;
    CONTINUE WHEN unit.id IS NULL;
    SELECT p.id INTO requester FROM profiles p JOIN stores s ON s.id = p.store_id WHERE s.code = r.store AND p.role = 'user' AND p.vendor_company_id IS NULL ORDER BY p.created_at LIMIT 1;
    CONTINUE WHEN requester IS NULL;
    INSERT INTO requests (request_no, title, requester_id, service_id, team_id, category_id, org_id, status, created_at, resolved_at, updated_at)
    VALUES ('', 'DEMOCAL ' || r.store || ' AC ' || r.ac, requester, svc, team, cat, org,
            CASE WHEN r.fixed IS NULL THEN 'in_progress' ELSE 'resolved' END::request_status,
            now() - make_interval(days => r.raised) - interval '3 hours',
            CASE WHEN r.fixed IS NULL THEN NULL ELSE now() - make_interval(days => r.raised - r.fixed) - interval '3 hours' END,
            now())
    RETURNING id INTO rid;
    INSERT INTO request_master_snapshots (request_id, kind, unit_ids, snapshot)
    VALUES (rid, 'ac', ARRAY[unit.id], jsonb_build_array(jsonb_build_object('id', unit.id, 'store_code', unit.store_code, 'ckdesk_no', unit.ckdesk_no, 'serial', unit.serial, 'brand', unit.brand, 'tonnage', unit.tonnage)));
  END LOOP;
END $$;

COMMIT;
SELECT count(*) AS demo_tickets FROM requests WHERE title LIKE 'DEMOCAL%';
