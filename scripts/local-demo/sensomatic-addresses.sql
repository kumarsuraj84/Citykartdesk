-- LOCAL ONLY (the LOCAL dev database, never a server): shows the SENSOMATIC ("Sensor Machine") program with and without e-mail addresses.
-- On live the sheet's address columns are empty until the owner's formulas are in; here the same thing is done by hand so the check list can be looked at:
--   fill   : gives every store row a made-up address  <vendor>.service@example.test  (nothing real; local mail only goes to the local outbox)
--   undo   : empties them again (back to what live looks like today)
-- Run ONE of them:
--   docker exec -i supabase_db_citykart_desk psql -U supabase_admin -d postgres -v action=fill < scripts/local-demo/sensomatic-addresses.sql
--   docker exec -i supabase_db_citykart_desk psql -U supabase_admin -d postgres -v action=undo < scripts/local-demo/sensomatic-addresses.sql
-- Then open Admin > Vendor Programs > Sensor Machine > "Check my set-up" (reload the page).
begin;
\if :{?action}
\else
  \set action undo
\endif
select :'action' as action;

update public.program_rows r set
  emails = case when :'action' = 'fill' then array[lower(regexp_replace(coalesce(nullif(r.vendor, ''), 'vendor'), '[^A-Za-z0-9]+', '', 'g')) || '.service@example.test'] else '{}'::text[] end
where r.program_id = (select id from public.vendor_programs where name = 'Sensor Machine');

-- The "Problems found" list of the program is saved when the sheet is read, and the check list counts from it. A sheet read with real addresses would drop the
-- "mail column is empty" warnings, so do the same here (fill) or put them back exactly as the sheet read had them (undo).
delete from public.program_issues where program_id = (select id from public.vendor_programs where name = 'Sensor Machine') and code in ('no_email', 'no_valid_email');
insert into public.program_issues (org_id, program_id, severity, code, store_code, sheet_row, message)
select r.org_id, r.program_id, 'warning', 'no_email', r.store_code, r.sheet_row,
       'Row ' || r.sheet_row || ' (' || r.store_code || '): the mail column is empty, so a ticket for it cannot be mailed to the vendor.'
from public.program_rows r
where :'action' <> 'fill' and r.is_active and cardinality(r.emails) = 0 and r.program_id = (select id from public.vendor_programs where name = 'Sensor Machine');

select count(*) as rows, count(*) filter (where cardinality(emails) > 0) as rows_with_an_address from public.program_rows where program_id = (select id from public.vendor_programs where name = 'Sensor Machine');
commit;
