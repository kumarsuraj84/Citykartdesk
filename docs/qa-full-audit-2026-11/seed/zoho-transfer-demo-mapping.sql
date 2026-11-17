-- Stage-1 demo mapping for the made-up Zoho templates (AUDIT stack only: docker exec -i supabase_db_ckdesk_audit psql -U postgres -d postgres < this file).
-- The AC template is mapped by hand through the screen in the demo; this file fills in two more templates and leaves some gaps ON PURPOSE
-- (Admin-General, IT "Software", and the whole HR template) so the preview shows what "cannot move yet" looks like.
BEGIN;
WITH o AS (SELECT id AS org_id FROM organizations LIMIT 1),
     t AS (SELECT name, id FROM form_templates),
     s AS (SELECT name, id FROM services),
     c AS (SELECT name, id FROM service_categories)
INSERT INTO zoho_map_templates (org_id, zoho_template, form_template_id)
SELECT o.org_id, v.z, (SELECT id FROM t WHERE name = v.f) FROM o, (VALUES
  ('Admin Issue log System', 'QA ADMIN REQUIREMENT TEMPLATE'),
  ('IT Issue log System',    'QA GENERAL TEMPLATE')) v(z, f)
ON CONFLICT DO NOTHING;

INSERT INTO zoho_map_services (org_id, zoho_template, zoho_category, service_id)
SELECT (SELECT id FROM organizations LIMIT 1), v.z, v.cat, (SELECT id FROM services WHERE name = v.svc) FROM (VALUES
  ('Admin Issue log System', 'Admin-Requirement', 'QA ADMIN - REQUIREMENTS (NON TRADING)'),
  ('AC Issues Log System Only - Admin Team', 'Admin-Genset', 'QA ADMIN - AC AND GENSET ISSUES'),
  ('IT Issue log System',    'IT Support',        'QA IT SUPPORT')) v(z, cat, svc)
ON CONFLICT DO NOTHING;

INSERT INTO zoho_map_categories (org_id, zoho_template, zoho_category, zoho_subcategory, category_id)
SELECT (SELECT id FROM organizations LIMIT 1), v.z, v.cat, v.sub, (SELECT id FROM service_categories WHERE name = v.ck) FROM (VALUES
  ('Admin Issue log System', 'Admin-Requirement', 'Fixtures', 'QA FIXTURES'),
  ('Admin Issue log System', 'Admin-Requirement', 'Hangers',  'QA HANGERS'),
  ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Not Cooling',  'QA AC ISSUE'),
  ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Installation', 'QA AC ISSUE'),
  ('AC Issues Log System Only - Admin Team', 'Admin-Genset', 'Genset Not Starting', 'QA GENSET ISSUE'),
  ('IT Issue log System',    'IT Support',        'Laptop',   'QA IT SUPPORT')) v(z, cat, sub, ck)
ON CONFLICT DO NOTHING;
INSERT INTO zoho_map_items (org_id, zoho_template, zoho_category, zoho_subcategory, zoho_item, sub_category_id)
SELECT (SELECT id FROM organizations LIMIT 1), v.z, v.cat, v.sub, v.item, (SELECT id FROM service_sub_categories WHERE name = v.ck) FROM (VALUES
  ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Not Cooling',  'Split AC',  'AC not cooling'),
  ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Not Cooling',  'Window AC', 'AC water leakage'),
  ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Installation', 'Split AC',  'AC not cooling'),
  ('Admin Issue log System', 'Admin-Requirement', 'Fixtures', 'Shelf',  'FIXTURES 2 WAYS'),
  ('Admin Issue log System', 'Admin-Requirement', 'Hangers',  'Hanger', 'HANGERS CLIP 10')) v(z, cat, sub, item, ck)
ON CONFLICT DO NOTHING;

-- a few Zoho fields -> CK Desk form fields (the AC form's description box takes the AC number text, only as a demo of the coercion)
INSERT INTO zoho_map_fields (org_id, zoho_template, zoho_field, ck_field_id)
SELECT (SELECT id FROM organizations LIMIT 1), v.z, v.zf, v.ck FROM (VALUES
  ('AC Issues Log System Only - Admin Team', 'ac_floor', 'f_oemno'),
  ('Admin Issue log System', 'emp_code', 'f_contact')) v(z, zf, ck)
ON CONFLICT DO NOTHING;
COMMIT;
SELECT 'templates' k, count(*) FROM zoho_map_templates UNION ALL SELECT 'services', count(*) FROM zoho_map_services UNION ALL SELECT 'categories', count(*) FROM zoho_map_categories UNION ALL SELECT 'items', count(*) FROM zoho_map_items UNION ALL SELECT 'statuses', count(*) FROM zoho_map_values;
