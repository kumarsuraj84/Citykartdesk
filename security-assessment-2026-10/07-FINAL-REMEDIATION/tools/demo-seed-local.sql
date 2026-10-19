-- LOCAL DEMO ONLY (disposable audit database, synthetic people and stores). Shows the OEM-by-type, CVM and category-limited Qty features.
-- Never run this on a real system. Usage: replace the word :ts with the timestamp of the UAT users, then pipe to psql of the audit container.
\set ON_ERROR_STOP on
BEGIN;

-- people: the fixture technicians become the two CVMs of the example
UPDATE profiles SET full_name = 'Ankur' WHERE id = (SELECT id FROM auth.users WHERE email = 'uat-desk-003-:ts-agent-a@example.test');
UPDATE profiles SET full_name = 'Ajay'  WHERE id = (SELECT id FROM auth.users WHERE email = 'uat-desk-003-:ts-agent-b@example.test');

CREATE TEMP TABLE _d AS SELECT s.org_id, s.id AS service_id FROM services s WHERE s.name = 'D-03 Service A uat-desk-003-:ts';

-- OEMs: AC and Genset
INSERT INTO oems (org_id, name, kind, emails, is_active) SELECT org_id, 'AC - Bluestar UP', 'ac', ARRAY['ac-bluestar@demo.test'], true FROM _d;
INSERT INTO oems (org_id, name, kind, emails, is_active) SELECT org_id, 'AC - Voltas', 'ac', ARRAY['ac-voltas@demo.test'], true FROM _d;
INSERT INTO oems (org_id, name, kind, emails, is_active) SELECT org_id, 'Genset - Cummins', 'genset', ARRAY['genset-cummins@demo.test'], true FROM _d;

-- stores: ALC and ALD (CVM Ankur), BRD (CVM Ajay); ALC has Bluestar for AC and Cummins for Genset
INSERT INTO stores (org_id, code, name, city, oem_id, genset_oem_id, cvm_id)
SELECT d.org_id, 'ALC', 'Alwar City', 'Alwar', (SELECT id FROM oems WHERE name = 'AC - Bluestar UP'), (SELECT id FROM oems WHERE name = 'Genset - Cummins'),
       (SELECT id FROM auth.users WHERE email = 'uat-desk-003-:ts-agent-a@example.test') FROM _d d;
INSERT INTO stores (org_id, code, name, city, oem_id, genset_oem_id, cvm_id)
SELECT d.org_id, 'ALD', 'Alwar Depot', 'Alwar', (SELECT id FROM oems WHERE name = 'AC - Voltas'), NULL,
       (SELECT id FROM auth.users WHERE email = 'uat-desk-003-:ts-agent-a@example.test') FROM _d d;
INSERT INTO stores (org_id, code, name, city, oem_id, genset_oem_id, cvm_id)
SELECT d.org_id, 'BRD', 'Bareilly Road', 'Bareilly', (SELECT id FROM oems WHERE name = 'AC - Bluestar UP'), NULL,
       (SELECT id FROM auth.users WHERE email = 'uat-desk-003-:ts-agent-b@example.test') FROM _d d;

-- the requester belongs to store ALC
UPDATE profiles SET store_id = (SELECT id FROM stores WHERE code = 'ALC') WHERE id = (SELECT id FROM auth.users WHERE email = 'uat-desk-003-:ts-requester-a@example.test');

-- categories of the "Admin Requirements" example, tagged to the demo service
INSERT INTO service_categories (org_id, name, slug, auto_oem_kind)
SELECT org_id, c.name, 'demo-' || c.slug, c.kind FROM _d, (VALUES ('Genset', 'genset', 'genset'), ('AC Issues', 'ac', 'ac'), ('Fixture', 'fixture', NULL), ('Hangers', 'hangers', NULL),
  ('Fixture Attachments', 'fixture-attachments', NULL), ('Paint and repair', 'paint', NULL)) AS c(name, slug, kind);
INSERT INTO service_sub_categories (category_id, name, slug) SELECT id, name || ' - general', slug || '-general' FROM service_categories WHERE slug LIKE 'demo-%';
INSERT INTO service_sub_category_tags (service_id, sub_category_id) SELECT (SELECT service_id FROM _d), sc.id FROM service_sub_categories sc JOIN service_categories c ON c.id = sc.category_id WHERE c.slug LIKE 'demo-%';

-- a form template: Subject (always) and Qty (required, only for Fixture, Hangers and Fixture Attachments)
INSERT INTO form_templates (org_id, name, form_sections)
SELECT d.org_id, 'Admin Requirements (Non Trading) - demo', jsonb_build_array(jsonb_build_object('id', 'sec1', 'title', 'Request details', 'order', 0, 'fields', jsonb_build_array(
  jsonb_build_object('id', 'subject', 'type', 'text', 'label', 'Subject', 'required', true, 'order', 0),
  jsonb_build_object('id', 'qty', 'type', 'number', 'label', 'Qty', 'required', true, 'order', 1, 'validation', jsonb_build_object('min', 1),
    'show_for_categories', (SELECT jsonb_agg(id) FROM service_categories WHERE slug IN ('demo-fixture', 'demo-hangers', 'demo-fixture-attachments'))))))
FROM _d d;
UPDATE services SET template_id = (SELECT id FROM form_templates WHERE name = 'Admin Requirements (Non Trading) - demo') WHERE id = (SELECT service_id FROM _d);

COMMIT;
SELECT 'demo data ready: stores ' || (SELECT count(*) FROM stores WHERE code IN ('ALC','ALD','BRD')) || ', oems ' || (SELECT count(*) FROM oems) AS result;
