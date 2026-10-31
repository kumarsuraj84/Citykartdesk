-- LOCAL ONLY (the LOCAL dev database, never a server): puts the local app back to BEFORE the cut-over, so the morning demo can be watched again from the start:
--   * ADMIN AC ISSUE and the four GENSET categories are back on the OLD AC / Genset setting (this can only be done here, in SQL: the screens no longer allow it after the clean-up);
--   * SENSOMATIC (Sensor Machine) is switched off again and its made-up addresses are removed (as it is on live today).
-- It does NOT delete the demo tickets or the vendor companies / people / rules (they are harmless; delete them in the app if you like).
--   docker exec -i supabase_db_citykart_desk psql -U supabase_admin -d postgres < scripts/local-demo/reset-cutover.sql
-- Then run the cut-over again, for real, with the app's own actions:
--   npx vitest run --config vitest.demo.config.ts scripts/local-demo/01-cutover-ac-genset.demo.ts
begin;

update public.service_categories set auto_oem_kind = 'ac', program_id = null where name = 'ADMIN AC ISSUE';
update public.service_categories set auto_oem_kind = 'genset', program_id = null where name in ('GENSET-CUMMINS', 'GENSET-MAHINDRA', 'GENSET-EICHER', 'GENSET-KILOSKAR');

update public.vendor_programs set is_active = false where name = 'Sensor Machine';
update public.program_rows set emails = '{}' where program_id = (select id from public.vendor_programs where name = 'Sensor Machine');

select c.name, c.auto_oem_kind, c.program_id is not null as in_program from public.service_categories c where c.name in ('ADMIN AC ISSUE', 'GENSET-CUMMINS', 'GENSET-MAHINDRA', 'GENSET-EICHER', 'GENSET-KILOSKAR') order by 1;
select name, is_active from public.vendor_programs order by name;
commit;
