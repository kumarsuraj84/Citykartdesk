-- Citykart Desk - READ-ONLY check of the LIVE database (ckdesk on 10.0.0.205). It only reads. It changes nothing, creates nothing, and prints no passwords, hashes or personal data
-- (only counts and the names of tables/functions/policies and who may use them).
-- How to run it (on the database server, you type the postgres password yourself):
--     psql -U postgres -h localhost -d ckdesk -f live-readonly-check.sql -o live-state.txt
-- Then give me live-state.txt (nothing in it is secret).
SET default_transaction_read_only = on;
\pset format unaligned
\pset tuples_only on
select 'INFO|database|'||current_database()||'|'||version();
select 'INFO|read-only session|'||current_setting('transaction_read_only');
select 'INFO|database size MB|'||(pg_database_size(current_database())/1024/1024);
select 'INFO|tickets|'||(select count(*) from public.requests);
select 'INFO|profiles total|'||(select count(*) from public.profiles)||'|active|'||(select count(*) from public.profiles where is_active);
select 'INFO|organisations|'||(select count(*) from public.organizations);
select 'INFO|system_log rows|'||(select count(*) from public.system_log);
select 'INFO|attachments rows|'||(select count(*) from public.request_attachments);
select 'INFO|accounts still on the old shared import password|'||(select count(*) from auth.users where encrypted_password = extensions.crypt('Welcome@123', encrypted_password));
-- G-05: the development seed (supabase/seed.sql, in git history) creates suraj@citykart.org as platform_owner with a fixed password. This MUST print 0 on the live database.
-- If it prints 1, that password is still valid on live: change it at once (docs/HTTPS-AND-CSP-PLAN.md section "Seed password"). Only a count is printed, never a hash.
select 'INFO|owner account still on the git-history seed password (must be 0)|'||(select count(*) from auth.users where email = 'suraj@citykart.org' and encrypted_password = extensions.crypt('Welcome@citykart@123', encrypted_password));
-- H-28: the database time zone (the app itself must run with TZ=Asia/Kolkata); G-12/D-12 helpers
select 'INFO|database time zone (show timezone)|'||current_setting('TimeZone');
select 'INFO|new sign-ups land in the oldest organisation (handle_new_user): GOTRUE_DISABLE_SIGNUP must be true on the app server; organisations|'||(select count(*) from public.organizations);
select 'INFO|accounts forced to change password and not yet changed|'||(select count(*) from public.profiles where must_reset_password);
select 'INFO|latest migration recorded|'||coalesce((select max(version) from auth.schema_migrations where version ~ '^2024'), 'none');
select 'INFO|migrations 164-170 already recorded|'||(select count(*) from auth.schema_migrations where version in ('20240101000164','20240101000165','20240101000166','20240101000167','20240101000168','20240101000169','20240101000170'));
select 'INFO|functions anon may execute|'||(select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE'));
select 'INFO|tables anon may read|'||(select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') and has_table_privilege('anon', c.oid, 'SELECT'));
select 'INFO|extension pgcrypto|'||coalesce((select extversion from pg_extension where extname='pgcrypto'),'missing');
-- the privilege / policy state (same query used on the rehearsal copy, so the two can be compared line by line)
select 'T|'||c.relname||'|auth:'||(has_table_privilege('authenticated',c.oid,'SELECT')::int)||(has_table_privilege('authenticated',c.oid,'INSERT')::int)||(has_table_privilege('authenticated',c.oid,'UPDATE')::int)||(has_table_privilege('authenticated',c.oid,'DELETE')::int)||'|anon:'||(has_table_privilege('anon',c.oid,'SELECT')::int)||(has_table_privilege('anon',c.oid,'INSERT')::int)||(has_table_privilege('anon',c.oid,'UPDATE')::int)||(has_table_privilege('anon',c.oid,'DELETE')::int)||'|svc:'||(has_table_privilege('service_role',c.oid,'SELECT')::int)||(has_table_privilege('service_role',c.oid,'INSERT')::int)||'|rls:'||c.relrowsecurity::int from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') order by 1;
select 'F|'||p.oid::regprocedure||'|auth:'||has_function_privilege('authenticated',p.oid,'EXECUTE')::int||'|anon:'||has_function_privilege('anon',p.oid,'EXECUTE')::int||'|svc:'||has_function_privilege('service_role',p.oid,'EXECUTE')::int from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1;
select 'P|'||tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage') order by 1;
