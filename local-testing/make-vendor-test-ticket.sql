-- LOCAL TESTING ONLY: turns the existing COB store AC ticket CKSD-000385 into an OPEN ticket assigned to the Blue Star technician, with its AC saved from the AC master,
-- and with the OEM boxes emptied, so the vendor screens can be tried. Safe to run again.
BEGIN;
UPDATE requests SET status='open', assigned_to=(SELECT id FROM profiles WHERE full_name='Blue Star Technician One'),
  resolved_at=NULL, closed_at=NULL, waiting_since=NULL, responded_at=NULL, cancellation_reason=NULL, reopen_deadline_at=NULL
WHERE request_no='CKSD-000385';
INSERT INTO request_master_snapshots (request_id, kind, unit_ids, snapshot)
SELECT r.id, 'ac', ARRAY[u.id], jsonb_build_array(to_jsonb(u) - 'org_id')
FROM requests r JOIN master_ac_units u ON u.store_code='COB' AND u.ckdesk_no='1' AND u.removed_at IS NULL
WHERE r.request_no='CKSD-000385'
ON CONFLICT (request_id, kind) DO UPDATE SET snapshot=EXCLUDED.snapshot, unit_ids=EXCLUDED.unit_ids;
COMMIT;
SELECT request_no, status, (SELECT full_name FROM profiles WHERE id=assigned_to) AS assignee,
  (SELECT string_agg(f->>'label', ' | ') FROM jsonb_array_elements(form_sections_snapshot) s, jsonb_array_elements(s->'fields') f WHERE f->>'label' ILIKE '%OEM%' OR f->>'label' ILIKE '%resolution%') AS vendor_fields
FROM requests WHERE request_no='CKSD-000385';
