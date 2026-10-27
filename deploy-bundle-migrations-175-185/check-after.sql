-- READ ONLY. Run on 10.0.0.205 after run-migrations.ps1 said DONE (and again after the sheets have been copied):
--   psql -U postgres -h localhost -d ckdesk -f check-after.sql
-- It changes nothing.
\echo '--- migrations 175-185 recorded (expect 10 rows: 175,177,178,179,180,181,182,183,184,185)'
select version from auth.schema_migrations where version between '20240101000175' and '20240101000185' order by 1;

\echo '--- the tables of the sheets (rows are 0 until the first sheet copy)'
select 'master_sources' t, count(*) from public.master_sources
union all select 'master_ac_units', count(*) from public.master_ac_units
union all select 'master_gensets', count(*) from public.master_gensets
union all select 'master_store_cvm', count(*) from public.master_store_cvm
union all select 'master_pms_dates', count(*) from public.master_pms_dates
union all select 'master_issues', count(*) from public.master_issues
union all select 'vendor_companies (must stay 0 until the vendor portal starts)', count(*) from public.vendor_companies
union all select 'vendor logins (must stay 0)', count(*) from public.profiles where vendor_company_id is not null;

\echo '--- AC sheet copy: active units per store that has MORE rows than distinct sheet rows (must return 0 rows = no duplicates)'
select store_code, count(*) units, count(distinct sheet_row) distinct_rows
from public.master_ac_units where removed_at is null group by store_code having count(*) <> count(distinct sheet_row);

\echo '--- the category switches added by the release'
select name, auto_cvm_approval, show_approval_history, is_pms from public.service_categories where auto_cvm_approval or show_approval_history or is_pms order by name;

\echo '--- who may change categories / form templates / technician groups (expect admin, platform_owner only)'
select tablename, policyname, qual from pg_policies where policyname in ('categories_admin','form_templates_admin','teams_admin') order by 1;

\echo '--- ticket and people counts (compare with the BEFORE numbers printed by run-migrations.ps1)'
select (select count(*) from public.requests) tickets, (select count(*) from public.profiles) people;
