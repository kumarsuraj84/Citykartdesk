-- LOCAL TEST ONLY (dev database on this PC). Never run on the live server.
-- Marks the AC-PMS category you created as "the AC PMS category" and adds the two routing rules, the same way the AC rules send normal AC tickets to the vendor technicians:
-- PMS tickets of a Voltas / Blue Star store go to a Voltas / Blue Star technician. On the live server the Administrator ticks "AC PMS category" on the category and
-- creates the rules in Admin > Business Rules.
-- Safe to run twice.
BEGIN;

UPDATE service_categories SET is_pms = true WHERE slug = 'ac-pms';

DELETE FROM business_rules WHERE name IN ('[LOCAL TEST] AC PMS tickets of Blue Star go to a Blue Star technician', '[LOCAL TEST] AC PMS tickets of Voltas go to a Voltas technician');

INSERT INTO business_rules (org_id, name, is_active, trigger, conditions, conditions_logic, actions, execution_order, last_assigned_index)
SELECT r.org_id, replace(r.name, 'AC tickets', 'AC PMS tickets'), true, r.trigger,
       jsonb_set(r.conditions, '{0,value}', to_jsonb((SELECT id::text FROM service_categories WHERE slug = 'ac-pms'))),
       r.conditions_logic, r.actions, r.execution_order, 0
FROM business_rules r
WHERE r.name IN ('[LOCAL TEST] AC tickets of Blue Star go to a Blue Star technician', '[LOCAL TEST] AC tickets of Voltas go to a Voltas technician');

SELECT name, is_active, conditions->0->>'value' AS category_id FROM business_rules WHERE name LIKE '[LOCAL TEST] AC PMS%';
SELECT name, is_pms FROM service_categories WHERE is_pms;
COMMIT;
