-- LOCAL TESTING ONLY: makes two more OPEN Voltas tickets (copies of the ALC demo ticket) for the Part required and PO required demos.
INSERT INTO requests (request_no, title, description, requester_id, service_id, team_id, category_id, sub_category_id, priority, status, assigned_to, form_data, form_sections_snapshot, form_schema_snapshot, org_id, response_due_at, resolution_due_at, source_metadata)
SELECT '', 'UAT demo ' || t.n || ' - ' || t.what, r.description, r.requester_id, r.service_id, r.team_id, r.category_id, r.sub_category_id, r.priority, 'open', r.assigned_to,
       jsonb_set(r.form_data - 'mu6lt1jt_x', '{}', r.form_data), r.form_sections_snapshot, r.form_schema_snapshot, r.org_id, r.response_due_at, r.resolution_due_at, r.source_metadata
FROM requests r, (VALUES ('D', 'Voltas AC 2 - compressor burnt (revised price demo)')) AS t(n, what)
WHERE r.title LIKE 'UAT demo A - Voltas AC 1 not cooling at ALC';
INSERT INTO request_master_snapshots (request_id, kind, unit_ids, snapshot)
SELECT n.id, 'ac', s.unit_ids, s.snapshot FROM requests n JOIN requests a ON a.title LIKE 'UAT demo A - Voltas AC 1 not cooling at ALC' JOIN request_master_snapshots s ON s.request_id=a.id AND s.kind='ac'
WHERE n.title LIKE 'UAT demo D - %'
ON CONFLICT DO NOTHING;
-- clear the OEM boxes (the copy of A carries the number and resolution)
UPDATE requests SET form_data = (SELECT jsonb_object_agg(k, CASE WHEN k IN (SELECT f->>'id' FROM jsonb_array_elements(form_sections_snapshot) s, jsonb_array_elements(s->'fields') f WHERE f->>'label' IN ('AC OEM Ticket Number','AC OEM Ticket Creation Date','AC resolution')) THEN to_jsonb(''::text) ELSE v END) FROM jsonb_each(form_data) AS e(k, v))
WHERE title LIKE 'UAT demo D - %';
SELECT request_no, title, status, (SELECT full_name FROM profiles WHERE id=assigned_to) FROM requests WHERE title LIKE 'UAT demo _ - %' ORDER BY request_no;
