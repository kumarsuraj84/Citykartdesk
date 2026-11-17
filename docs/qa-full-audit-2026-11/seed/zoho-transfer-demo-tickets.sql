-- Stage-1 demo data for the Zoho -> CK Desk transfer screens. Run ONLY on the disposable AUDIT stack's `zohoaudit` database
-- (docker exec -i supabase_db_ckdesk_audit psql -U postgres -d zohoaudit < this file). All people and tickets are made up (@audit.test / @example.test).
-- Zoho ticket numbers 700001.. so they never collide with the 61 older synthetic tickets.
BEGIN;
DELETE FROM zoho_ticket WHERE display_id BETWEEN 700001 AND 700999;

INSERT INTO zoho_ticket (zoho_id, display_id, template, created_at, resolved_at, status, priority, category, subcategory, item, group_name,
                         requester_name, requester_email, technician_name, technician_email, subject, udf, raw, ac_number, ac_floor, emp_code)
SELECT 'demo-' || (700000 + g), 700000 + g,
       t.template,
       now() - ((g * 37) % 400 + 2) * interval '1 day',
       CASE WHEN t.status IN ('Closed', 'Resolved') THEN now() - ((g * 37) % 400 - 1) * interval '1 day' END,
       t.status, t.priority, t.category, t.subcategory, t.item, t.grp,
       t.req_name, t.req_email, t.tech_name, t.tech_email,
       'Demo ' || t.category || ' - ' || t.item || ' #' || g,
       jsonb_build_object('udf_char3', '9000000000'), '{}'::jsonb,
       CASE WHEN t.template LIKE 'AC Issues%' THEN (1 + g % 4)::text END,
       CASE WHEN t.template LIKE 'AC Issues%' THEN (g % 3)::text END,
       CASE WHEN t.template LIKE 'Admin Issue%' THEN 'E' || (1000 + g) END
FROM generate_series(1, 150) g
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    -- template, category, subcategory, item, status, priority, group, requester, requester e-mail, technician, technician e-mail
    ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Not Cooling',   'Split AC',   'Closed',      'High',   'Admin AC Service', 'QA11 Store Requester', 'qa11.store@audit.test', 'QA11 Technician One', 'qa11.tech@audit.test'),
    ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Not Cooling',   'Window AC',  'In Process',  'High',   'Admin AC Service', 'S0123',                'store.s0123@example.test', 'Ravi Kumar', 'ravi.k@example.test'),
    ('AC Issues Log System Only - Admin Team', 'Admin-AC', 'AC Installation',  'Split AC',   'Open',        'Medium', 'Admin AC Service', 'QA11 Store Requester', 'qa11.store@audit.test', NULL, NULL),
    ('AC Issues Log System Only - Admin Team', 'Admin-Genset', 'Genset Not Starting', 'Genset', 'Resolved', 'High',   'Admin AC Service', 'S0456',                'store.s0456@example.test', 'QA11 Technician Two', 'qa11.tech2@audit.test'),
    ('Admin Issue log System', 'Admin-Requirement', 'Fixtures', 'Shelf',          'Open',        'Low',    'Admin',            'QA11 HO Requester',    'qa11.ho@audit.test', NULL, NULL),
    ('Admin Issue log System', 'Admin-Requirement', 'Hangers',  'Hanger',         'On Hold Due to Purchase from HO', 'Medium', 'Admin', 'QA11 HO Requester', 'qa11.ho@audit.test', 'QA11 Technician One', 'qa11.tech@audit.test'),
    ('Admin Issue log System', 'Admin-General', 'Housekeeping', 'Cleaning',       'Closed',      'Low',    'Admin',            'Priya Sharma',         'priya.sharma@example.test', 'Suresh Patil', 'suresh.p@example.test'),
    ('IT Issue log System', 'IT Support', 'Laptop', 'Laptop not starting',        'Closed',      'Medium', 'IT',               'QA11 HO Requester',    'qa11.ho@audit.test', 'QA11 Technician Two', 'qa11.tech2@audit.test'),
    ('IT Issue log System', 'IT Support', 'Software', 'Access request',           'Reject',      'Low',    'IT',               'Priya Sharma',         'priya.sharma@example.test', NULL, NULL),
    ('HR Issue log System', 'Leave', 'Leave balance', 'Query',                    'On Hold Due to Approval', 'Low', 'HR',      'Priya Sharma',         'priya.sharma@example.test', NULL, NULL)
  ) AS v(template, category, subcategory, item, status, priority, grp, req_name, req_email, tech_name, tech_email)
  OFFSET (g % 10) LIMIT 1
) t;

COMMIT;
SELECT template, count(*) FROM zoho_ticket GROUP BY 1 ORDER BY 2 DESC;
