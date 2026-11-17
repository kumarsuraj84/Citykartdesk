-- Demo CONVERSATION for the made-up Zoho tickets 700001.. (e-mails, a reply from the requester, a technician note, recorded changes).
-- AUDIT stack only: docker exec -i supabase_db_ckdesk_audit psql -U postgres -d zohoaudit < this file. All text is made up.
BEGIN;
DELETE FROM zoho_email   WHERE ticket_zoho_id LIKE 'demo-7%';
DELETE FROM zoho_note    WHERE ticket_zoho_id LIKE 'demo-7%';
DELETE FROM zoho_history WHERE ticket_zoho_id LIKE 'demo-7%';
DELETE FROM zoho_conversation WHERE ticket_zoho_id LIKE 'demo-7%';
DELETE FROM zoho_task WHERE ticket_zoho_id LIKE 'demo-7%';
DELETE FROM zoho_worklog WHERE ticket_zoho_id LIKE 'demo-7%';

-- 1) the acknowledgement the old system e-mailed, 2) the requester's reply
INSERT INTO zoho_email (ticket_zoho_id, item_id, kind, sent_at, subject, sender, body, has_attachments, raw)
SELECT t.zoho_id, 'ack-' || t.display_id, 'ACKNOWLEDGEMENT', t.created_at + interval '2 minutes',
       'Ticket #' || t.display_id || ' received: ' || t.subject, 'Citykart Helpdesk <helpdesk@example.test>',
       '<p>Dear ' || t.requester_name || ',</p><p>We have received your request and a technician will be assigned shortly.</p>', false, '{}'::jsonb
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150;

INSERT INTO zoho_email (ticket_zoho_id, item_id, kind, sent_at, subject, sender, body, has_attachments, raw)
SELECT t.zoho_id, 'reply-' || t.display_id, 'REQREPLY', t.created_at + interval '1 day',
       'Re: Ticket #' || t.display_id, t.requester_name || ' <' || t.requester_email || '>',
       '<p>Any update please? It is still not working. <b>Urgent</b> for the store.</p>', false, '{}'::jsonb
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.requester_email IS NOT NULL;

-- a technician note on the tickets that had a technician
INSERT INTO zoho_note (ticket_zoho_id, item_id, created_at, raw)
SELECT t.zoho_id, 'note-' || t.display_id, t.created_at + interval '2 days',
       jsonb_build_object('description', '<p>Visited the store. Parts needed, will revisit.</p>', 'created_by', jsonb_build_object('name', t.technician_name))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.technician_name IS NOT NULL;

-- recorded changes
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h1-' || t.display_id, t.created_at, 'add', jsonb_build_object('description', 'Ticket raised', 'by', jsonb_build_object('name', t.requester_name))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h2-' || t.display_id, t.created_at + interval '3 hours', 'update', jsonb_build_object('description', 'Assigned to ' || t.technician_name, 'by', jsonb_build_object('name', 'Admin'))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.technician_name IS NOT NULL;
-- the store's own message, and the approval status (every third ticket went through an approval)
UPDATE zoho_ticket t SET raw = jsonb_build_object('request', jsonb_build_object(
  'description', '<p>Dear team, ' || t.subject || '. Please attend <b>urgently</b>.</p>',
  'approval_status', jsonb_build_object('name', CASE WHEN t.display_id % 3 = 0 THEN 'Approved' ELSE 'Not Required' END)))
WHERE t.display_id BETWEEN 700001 AND 700150;
-- the approval: the technician sends it for approval at +4h, the approver decides at +5h (each with its own time and person)
-- in the SAME shapes the real Zoho copy has (checked on real approved tickets): approver_added, approval_status_change (System), req_approval, approve with "Approval Comments"
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h3x-' || t.display_id, t.created_at + interval '4 hours', 'approver_added', jsonb_build_object('description', 'Stage I  Approver Added : regional.manager@example.test', 'by', jsonb_build_object('name', coalesce(t.technician_name, 'Admin')))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.display_id % 3 = 0;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h3s-' || t.display_id, t.created_at + interval '4 hours', 'approval_status_change', jsonb_build_object('description', 'Approval Status modified from - to Pending Approval', 'by', jsonb_build_object('name', 'System'))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.display_id % 3 = 0;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h3a-' || t.display_id, t.created_at + interval '4 hours 1 minute', 'req_approval', jsonb_build_object('description', 'Approval mail sent to regional.manager@example.test In Stage I', 'by', jsonb_build_object('name', coalesce(t.technician_name, 'Admin')))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.display_id % 3 = 0;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h3-' || t.display_id, t.created_at + interval '5 hours', 'approve', jsonb_build_object('description', 'Approved By : regional.manager@example.test In Stage I<br>Approval Comments : ok to proceed', 'by', jsonb_build_object('name', 'Regional Manager'))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.display_id % 3 = 0;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h3t-' || t.display_id, t.created_at + interval '5 hours', 'approval_status_change', jsonb_build_object('description', 'Approval Status modified from Pending Approval to Approved', 'by', jsonb_build_object('name', 'System'))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.display_id % 3 = 0;
INSERT INTO zoho_conversation (ticket_zoho_id, item_id, kind, created_at, raw)
SELECT t.zoho_id, 'c1-' || t.display_id, 'REPLY', t.created_at + interval '6 hours', jsonb_build_object('description', '<p>Store confirmed the AC is switched off at night.</p>', 'created_by', jsonb_build_object('name', t.requester_name))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150;
INSERT INTO zoho_task (ticket_zoho_id, item_id, raw)
SELECT t.zoho_id, 'task-' || t.display_id, jsonb_build_object('title', 'Replace capacitor', 'status', jsonb_build_object('name', 'Open'), 'owner', jsonb_build_object('name', t.technician_name))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.technician_name IS NOT NULL;
INSERT INTO zoho_worklog (ticket_zoho_id, item_id, raw)
SELECT t.zoho_id, 'wl-' || t.display_id, jsonb_build_object('description', 'Site visit and gas check', 'time_spent', '01:30', 'owner', jsonb_build_object('name', t.technician_name))
FROM zoho_ticket t WHERE t.display_id BETWEEN 700001 AND 700150 AND t.technician_name IS NOT NULL;
COMMIT;
SELECT (SELECT count(*) FROM zoho_email WHERE ticket_zoho_id LIKE 'demo-7%') emails, (SELECT count(*) FROM zoho_note WHERE ticket_zoho_id LIKE 'demo-7%') notes, (SELECT count(*) FROM zoho_history WHERE ticket_zoho_id LIKE 'demo-7%') history;
