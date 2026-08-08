-- ============================================================
-- Fix: RLS policies check admin/manager role but omit platform_owner,
-- which locks the platform_owner account out of almost every table
-- it didn't personally create/get assigned to (requests, tasks,
-- services, custom fields, SLA config, teams, etc.). Same root cause
-- as the application-layer permission checks fixed earlier — the
-- database-level check was never updated when platform_owner was
-- introduced as a role above admin.
--
-- This patches every affected policy in place: only the role list in
-- the existing USING/WITH CHECK expression is extended to include
-- platform_owner — no other logic changes.
-- ============================================================

DO $$
DECLARE
  pol RECORD;
  new_qual TEXT;
  new_check TEXT;
  roles_clause TEXT;
  sql TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual IS NOT NULL AND qual LIKE '%current_user_role()%'
          AND (qual LIKE '%''admin''%' OR qual LIKE '%''manager''%')
          AND qual NOT LIKE '%platform_owner%')
        OR
        (with_check IS NOT NULL AND with_check LIKE '%current_user_role()%'
          AND (with_check LIKE '%''admin''%' OR with_check LIKE '%''manager''%')
          AND with_check NOT LIKE '%platform_owner%')
      )
  LOOP
    new_qual := pol.qual;
    new_check := pol.with_check;

    IF new_qual IS NOT NULL THEN
      new_qual := replace(new_qual,
        $q$ARRAY['admin'::user_role, 'manager'::user_role]$q$,
        $q$ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]$q$);
      new_qual := replace(new_qual,
        $q$ARRAY['manager'::user_role, 'admin'::user_role]$q$,
        $q$ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]$q$);
      new_qual := replace(new_qual,
        $q$current_user_role() = 'admin'::user_role$q$,
        $q$current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])$q$);
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := replace(new_check,
        $q$ARRAY['admin'::user_role, 'manager'::user_role]$q$,
        $q$ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]$q$);
      new_check := replace(new_check,
        $q$ARRAY['manager'::user_role, 'admin'::user_role]$q$,
        $q$ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]$q$);
      new_check := replace(new_check,
        $q$current_user_role() = 'admin'::user_role$q$,
        $q$current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])$q$);
    END IF;

    -- Defensive: only touch policies where the replace actually changed something.
    IF new_qual IS DISTINCT FROM pol.qual OR new_check IS DISTINCT FROM pol.with_check THEN
      roles_clause := array_to_string(pol.roles, ', ');

      EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

      sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
        pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        pol.cmd, roles_clause);

      IF new_qual IS NOT NULL THEN
        sql := sql || format(' USING (%s)', new_qual);
      END IF;
      IF new_check IS NOT NULL THEN
        sql := sql || format(' WITH CHECK (%s)', new_check);
      END IF;

      EXECUTE sql;

      RAISE NOTICE 'Patched policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
    END IF;
  END LOOP;
END $$;
