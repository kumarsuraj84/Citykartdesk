-- STAGE 4 QA: a LARGE made-up Zoho set to measure speed. AUDIT stack only (docker exec -i supabase_db_ckdesk_audit psql -U postgres -d zohoaudit < this file).
-- 10,000 tickets, numbers 800001..810000, all using the AC template that the demo mapping already maps, with a conversation, a technician note, history and (1 in 10) an approval.
-- Remove with:  DELETE FROM zoho_ticket WHERE display_id BETWEEN 800001 AND 810000; (and the rows of the other tables whose ticket_zoho_id starts with 'scale-')
BEGIN;
DELETE FROM zoho_email    WHERE ticket_zoho_id LIKE 'scale-%';
DELETE FROM zoho_note     WHERE ticket_zoho_id LIKE 'scale-%';
DELETE FROM zoho_history  WHERE ticket_zoho_id LIKE 'scale-%';
DELETE FROM zoho_ticket   WHERE display_id BETWEEN 800001 AND 810000;

INSERT INTO zoho_ticket (zoho_id, display_id, template, created_at, resolved_at, status, priority, category, subcategory, item, group_name,
                         requester_name, requester_email, technician_name, technician_email, subject, udf, raw, ac_number, ac_floor)
SELECT 'scale-' || (800000 + g), 800000 + g,
       'AC Issues Log System Only - Admin Team',
       now() - ((g * 7) % 700 + 2) * interval '1 day' - (g % 24) * interval '1 hour',
       CASE WHEN s.status IN ('Closed', 'Resolved') THEN now() - ((g * 7) % 700 - 1) * interval '1 day' END,
       s.status, 'High', 'Admin-AC', 'AC Not Cooling', CASE WHEN g % 2 = 0 THEN 'Split AC' ELSE 'Window AC' END, 'Admin AC Service',
       CASE WHEN g % 10 < 8 THEN 'QA11 Store Requester' ELSE 'Scale Store ' || (g % 50) END,
       CASE WHEN g % 10 < 8 THEN 'qa11.store@audit.test' ELSE 'scale.store' || (g % 50) || '@example.test' END,
       CASE WHEN g % 3 = 0 THEN NULL WHEN g % 2 = 0 THEN 'QA11 Technician One' ELSE 'QA11 Technician Two' END,
       CASE WHEN g % 3 = 0 THEN NULL WHEN g % 2 = 0 THEN 'qa11.tech@audit.test' ELSE 'qa11.tech2@audit.test' END,
       'Scale ticket ' || g || ' - AC not cooling', jsonb_build_object('udf_char3', '9000000000'),
       jsonb_build_object('request', jsonb_build_object('description', '<p>Scale ticket ' || g || '. AC is <b>not cooling</b>, please attend.</p>',
         'approval_status', jsonb_build_object('name', CASE WHEN g % 10 = 0 THEN 'Approved' ELSE 'Not Required' END),
         'responded_time', jsonb_build_object('value', (extract(epoch from now() - ((g * 7) % 700 + 1) * interval '1 day') * 1000)::bigint::text))),
       (1 + g % 4)::text, (g % 3)::text
FROM generate_series(1, 10000) g
CROSS JOIN LATERAL (SELECT (ARRAY['Closed','Closed','Closed','Closed','Resolved','Open','Open','In Process','In Process','Closed'])[1 + g % 10] AS status) s;

INSERT INTO zoho_email (ticket_zoho_id, item_id, kind, sent_at, subject, sender, body, has_attachments, raw)
SELECT t.zoho_id, 'ack-' || t.display_id, 'ACKNOWLEDGEMENT', t.created_at + interval '2 minutes', 'Ticket #' || t.display_id || ' received', 'Citykart Helpdesk <helpdesk@example.test>',
       '<p>Dear ' || t.requester_name || ', we have received your request.</p>', false, '{}'::jsonb
FROM zoho_ticket t WHERE t.display_id BETWEEN 800001 AND 810000;
INSERT INTO zoho_email (ticket_zoho_id, item_id, kind, sent_at, subject, sender, body, has_attachments, raw)
SELECT t.zoho_id, 'reply-' || t.display_id, 'REQREPLY', t.created_at + interval '1 day', 'Re: Ticket #' || t.display_id, t.requester_name || ' <' || t.requester_email || '>',
       '<p>Any update please?</p>', false, '{}'::jsonb
FROM zoho_ticket t WHERE t.display_id BETWEEN 800001 AND 810000;
INSERT INTO zoho_note (ticket_zoho_id, item_id, created_at, raw)
SELECT t.zoho_id, 'note-' || t.display_id, t.created_at + interval '2 days', jsonb_build_object('description', '<p>Visited the store.</p>', 'created_by', jsonb_build_object('name', t.technician_name))
FROM zoho_ticket t WHERE t.display_id BETWEEN 800001 AND 810000 AND t.technician_name IS NOT NULL;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h1-' || t.display_id, t.created_at, 'add', jsonb_build_object('description', 'Ticket raised', 'by', jsonb_build_object('name', t.requester_name))
FROM zoho_ticket t WHERE t.display_id BETWEEN 800001 AND 810000;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'h2-' || t.display_id, t.created_at + interval '3 hours', 'update', jsonb_build_object('description', 'Assigned to ' || t.technician_name, 'by', jsonb_build_object('name', 'Admin'))
FROM zoho_ticket t WHERE t.display_id BETWEEN 800001 AND 810000 AND t.technician_name IS NOT NULL;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'ha-' || t.display_id, t.created_at + interval '4 hours', 'req_approval', jsonb_build_object('description', 'Approval mail sent to regional.manager@example.test In Stage I', 'by', jsonb_build_object('name', coalesce(t.technician_name, 'Admin')))
FROM zoho_ticket t WHERE t.display_id BETWEEN 800001 AND 810000 AND t.display_id % 10 = 0;
INSERT INTO zoho_history (ticket_zoho_id, item_id, happened_at, operation, raw)
SELECT t.zoho_id, 'hb-' || t.display_id, t.created_at + interval '5 hours', 'approve', jsonb_build_object('description', 'Approved By : regional.manager@example.test In Stage I<br>Approval Comments : ok', 'by', jsonb_build_object('name', 'Regional Manager'))
FROM zoho_ticket t WHERE t.display_id BETWEEN 800001 AND 810000 AND t.display_id % 10 = 0;
COMMIT;
SELECT (SELECT count(*) FROM zoho_ticket WHERE display_id BETWEEN 800001 AND 810000) tickets,
       (SELECT count(*) FROM zoho_email WHERE ticket_zoho_id LIKE 'scale-%') emails,
       (SELECT count(*) FROM zoho_history WHERE ticket_zoho_id LIKE 'scale-%') history;
