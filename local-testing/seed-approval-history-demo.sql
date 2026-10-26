-- LOCAL TEST ONLY (dev database on this PC). Never run on the live server.
-- Shows the "earlier requests of this store" box in an approval: ticks Qty "Show in approval history" on the ADMIN REQUIREMENT TEMPLATE and adds a few EARLIER,
-- already decided requests of the store ALC (login local.alc) for two sub-categories:
--   FIXTURES  > 4 WAYS( SS)                                     : 10 approved (3 Jul), 4 approved (12 Sep), 2 rejected (18 May, "not needed now")
--   HANGERS   > T-SHIRT HANGER 13.5"THIK (PP NATURAL) THIK HANGER : 120 approved (20 Aug), 60 approved (5 Oct)
-- decided by the store's CVM (Rahul Singh). Titles start with "[DEMO HISTORY]" so they can be removed with seed-approval-history-demo-cleanup.sql.
-- Safe to run twice (the earlier demo rows are removed first).
BEGIN;

-- 1. Qty is shown in the approval box
UPDATE form_templates t SET form_sections = (
  SELECT jsonb_agg(jsonb_set(s, '{fields}', (
    SELECT jsonb_agg(CASE WHEN f->>'label' = 'Qty' THEN jsonb_set(f, '{show_in_approval_history}', 'true'::jsonb, true) ELSE f END ORDER BY ord)
    FROM jsonb_array_elements(s->'fields') WITH ORDINALITY AS x(f, ord)
  )) ORDER BY sord)
  FROM jsonb_array_elements(t.form_sections) WITH ORDINALITY AS y(s, sord)
) WHERE t.name = 'ADMIN REQUIREMENT TEMPLATE';

-- 2. clean an earlier run
DELETE FROM approval_decisions WHERE approval_id IN (SELECT a.id FROM approvals a JOIN requests r ON r.id = a.request_id WHERE r.title LIKE '[DEMO HISTORY]%');
DELETE FROM approvals WHERE request_id IN (SELECT id FROM requests WHERE title LIKE '[DEMO HISTORY]%');
DELETE FROM approval_workflows WHERE name LIKE 'Ad-hoc approval DEMO HISTORY%';
DELETE FROM request_activity WHERE request_id IN (SELECT id FROM requests WHERE title LIKE '[DEMO HISTORY]%');
DELETE FROM requests WHERE title LIKE '[DEMO HISTORY]%';

-- 3. the earlier requests
DO $$
DECLARE
  org uuid := '00000000-0000-0000-0000-000000000001';
  svc uuid; team uuid; alc uuid; cvm uuid; qty text; sections jsonb;
  d record; rid uuid; wf uuid; ap uuid;
BEGIN
  SELECT s.id, s.team_id INTO svc, team FROM services s JOIN form_templates t ON t.id = s.template_id WHERE t.name = 'ADMIN REQUIREMENT TEMPLATE' LIMIT 1;
  SELECT p.id INTO alc FROM profiles p JOIN auth.users u ON u.id = p.id WHERE u.email = 'local.alc@example.test';
  SELECT p.id INTO cvm FROM profiles p JOIN auth.users u ON u.id = p.id WHERE lower(u.email) = 'rahul.singh@citykartstores.com';
  SELECT t.form_sections INTO sections FROM form_templates t WHERE t.name = 'ADMIN REQUIREMENT TEMPLATE';
  SELECT f->>'id' INTO qty FROM jsonb_array_elements(sections) s, jsonb_array_elements(s->'fields') f WHERE f->>'label' = 'Qty';
  IF svc IS NULL OR alc IS NULL OR cvm IS NULL OR qty IS NULL THEN RAISE EXCEPTION 'demo set-up not found (service %, store login %, CVM %, qty %)', svc, alc, cvm, qty; END IF;

  FOR d IN
    SELECT * FROM (VALUES
      ('2475c17d-4813-4199-8df2-79514d51e163'::uuid, '5dfe4643-7a81-440b-82c9-9bc247e095ac'::uuid, '4 WAYS( SS)',       10,  'approved', '2026-07-03 10:30+05:30'::timestamptz, 'Approved for 10, go ahead.'),
      ('2475c17d-4813-4199-8df2-79514d51e163'::uuid, '5dfe4643-7a81-440b-82c9-9bc247e095ac'::uuid, '4 WAYS( SS)',        4,  'approved', '2026-09-12 11:15+05:30'::timestamptz, 'Approved for 4.'),
      ('2475c17d-4813-4199-8df2-79514d51e163'::uuid, '5dfe4643-7a81-440b-82c9-9bc247e095ac'::uuid, '4 WAYS( SS)',        2,  'rejected', '2026-05-18 16:40+05:30'::timestamptz, 'Not needed now, the store is already stocked.'),
      ('539f2b41-eadd-4044-8811-2e8923ae63b3'::uuid, '1c155f6e-1861-4e19-bc46-1edfbeae2e4b'::uuid, 'T-SHIRT HANGER 13.5"', 120, 'approved', '2026-08-20 12:05+05:30'::timestamptz, 'Approved for 120 hangers.'),
      ('539f2b41-eadd-4044-8811-2e8923ae63b3'::uuid, '1c155f6e-1861-4e19-bc46-1edfbeae2e4b'::uuid, 'T-SHIRT HANGER 13.5"',  60, 'approved', '2026-10-05 09:50+05:30'::timestamptz, 'Approved for 60.')
    ) AS v(cat, sub, label, q, outcome, at, note)
  LOOP
    INSERT INTO requests (request_no, title, requester_id, service_id, team_id, status, category_id, sub_category_id, form_data, form_sections_snapshot, created_at, updated_at, cancellation_reason, org_id)
    VALUES ('', '[DEMO HISTORY] ' || d.label || ' x' || d.q, alc, svc, team, CASE WHEN d.outcome = 'approved' THEN 'closed' ELSE 'cancelled' END::request_status, d.cat, d.sub,
            jsonb_build_object(qty, d.q), sections, d.at - interval '1 hour', d.at, CASE WHEN d.outcome = 'rejected' THEN 'approval_rejected' END, org)
    RETURNING id INTO rid;
    INSERT INTO approval_workflows (name, org_id) VALUES ('Ad-hoc approval DEMO HISTORY ' || rid, org) RETURNING id INTO wf;
    INSERT INTO approval_workflow_steps (workflow_id, step_order, approver_type, approver_user_id) VALUES (wf, 1, 'specific_user', cvm);
    INSERT INTO approvals (request_id, workflow_id, status, current_step, requested_by, created_at) VALUES (rid, wf, d.outcome::approval_status, 0, alc, d.at - interval '1 hour') RETURNING id INTO ap;
    INSERT INTO approval_decisions (approval_id, step_order, decided_by, decision, comment, decided_at) VALUES (ap, 1, cvm, d.outcome::approval_decision_type, d.note, d.at);
  END LOOP;
END $$;

SELECT r.request_no, left(r.title, 45) AS title, a.status, r.form_data -> (SELECT f->>'id' FROM form_templates t, jsonb_array_elements(t.form_sections) s, jsonb_array_elements(s->'fields') f WHERE t.name = 'ADMIN REQUIREMENT TEMPLATE' AND f->>'label' = 'Qty') AS qty
FROM requests r JOIN approvals a ON a.request_id = r.id WHERE r.title LIKE '[DEMO HISTORY]%' ORDER BY r.created_at;
COMMIT;
