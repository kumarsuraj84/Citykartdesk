-- LOCAL ONLY (run against the LOCAL dev database, never a server): makes the demo program "AC (machine demo)" into a realistic program "AC",
-- with one row per AC of the local copy of the AC sheet (master_ac_units), so the AC cut-over can be looked at and tried in the local app:
--   Admin > Vendor Programs > AC   (the card "Move categories from the old AC / Genset setting" lists ADMIN AC ISSUE; move it, look, move it back from AC (built in)).
-- Safe to run again. Nothing in it touches tickets. The mail wording is the program's default wording; the resolution list is a SHORT EXAMPLE (copy the real AC list on live).
--   docker exec -i supabase_db_citykart_desk psql -U supabase_admin -d postgres < scripts/local-demo/prepare-ac-program.sql
begin;

with p as (
  select id, org_id from public.vendor_programs where name in ('AC (machine demo)', 'AC') order by (name = 'AC') desc limit 1
)
update public.vendor_programs v set
  name = 'AC', slug = 'ac', level = 'mail', row_type = 'machine', is_active = true, oem_number_required = true,
  columns = '{"vendor": "AC-AMC Vendor"}'::jsonb,
  details_template = '{{machine_no}} - {{extra_acfloor}}, {{extra_actype}} {{extra_actonnage}} - {{extra_acbrand}} - serial {{serial}}',
  mail_subject = 'New AC Issue Ticket - {{ticket_no}} - {{store_code}}',
  resolution_options = array['Repaired on site', 'Part replaced', 'Gas refilled', 'Cleaned and tested', 'Replaced the AC'],
  default_approver_ids = array(select id from public.profiles where role = 'platform_owner' order by created_at limit 1),
  last_status = 'ok', last_checked_at = now(), last_applied_at = now(), last_error = null
from p where v.id = p.id;

delete from public.program_rows where program_id = (select id from public.vendor_programs where name = 'AC');

insert into public.program_rows (org_id, program_id, store_code, machine_no, serial, vendor, emails, po_emails, approver_emails, extra, is_active, sheet_row)
select u.org_id, (select id from public.vendor_programs where name = 'AC'), u.store_code, u.ckdesk_no, u.serial, u.amc_vendor, u.emails, coalesce(u.po_emails, '{}'), coalesce(u.approver_emails, '{}'),
       jsonb_strip_nulls(jsonb_build_object('AC Floor', u.floor, 'AC Type', u.ac_type, 'AC Tonnage', u.tonnage, 'AC Brand', u.brand, 'AC-AMC Brand', u.amc_brand,
                                            'Region', u.region, 'State', u.state, 'Cluster', u.cluster)),
       u.is_active, u.sheet_row
from public.master_ac_units u
where u.removed_at is null;

update public.vendor_programs set row_count = (select count(*) from public.program_rows where program_id = vendor_programs.id) where name = 'AC';

select name, level, row_type, is_active, row_count from public.vendor_programs where name = 'AC';
commit;
