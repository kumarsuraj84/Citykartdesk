-- Qty field of the ADMIN REQUIREMENT TEMPLATE: accept only numbers from 1 to 10000.
-- The ticket form puts the limits on the number box in the browser, and the server checks them again when the ticket is saved (so a bypass is not possible).
-- Changes ONE setting of ONE field in ONE template. No program change, no restart. Safe to run twice. Tickets already created are not touched.
--
-- Run on 10.0.0.205 (live), after taking the usual backup:
--   psql -U postgres -h localhost -d ckdesk -f set-qty-limit-1-to-10000.sql
-- (type the postgres password yourself when psql asks)
BEGIN;

UPDATE form_templates t SET form_sections = (
  SELECT jsonb_agg(jsonb_set(s, '{fields}', (
    SELECT jsonb_agg(CASE WHEN f->>'label' = 'Qty' THEN jsonb_set(f, '{validation}', '{"min": 1, "max": 10000}'::jsonb, true) ELSE f END ORDER BY ord)
    FROM jsonb_array_elements(s->'fields') WITH ORDINALITY AS x(f, ord)
  )) ORDER BY sord)
  FROM jsonb_array_elements(t.form_sections) WITH ORDINALITY AS y(s, sord)
) WHERE t.name = 'ADMIN REQUIREMENT TEMPLATE';

-- what is set now (should show exactly one row: {"max": 10000, "min": 1})
SELECT t.name AS template, f->>'label' AS field, f->'validation' AS limits
FROM form_templates t, jsonb_array_elements(t.form_sections) s, jsonb_array_elements(s->'fields') f
WHERE t.name = 'ADMIN REQUIREMENT TEMPLATE' AND f->>'label' = 'Qty';

COMMIT;
