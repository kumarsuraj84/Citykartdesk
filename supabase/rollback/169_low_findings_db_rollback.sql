-- Rollback of 169. Restores the old activity policy, the old home-dashboard function and the previous function grants.
BEGIN;
DROP POLICY IF EXISTS "request_activity_select" ON request_activity;
CREATE POLICY "request_activity_select" ON request_activity FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id AND r.org_id = current_org_id()
      AND (r.requester_id = auth.uid() OR r.team_id = ANY(current_user_team_ids()) OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
  )
);
DROP FUNCTION IF EXISTS public.get_home_dashboard(boolean, boolean, uuid, boolean);
ALTER FUNCTION public.get_home_dashboard_core(boolean, boolean, uuid, boolean) RENAME TO get_home_dashboard;
GRANT EXECUTE ON FUNCTION public.get_home_dashboard(boolean, boolean, uuid, boolean) TO PUBLIC;
-- put back exactly the functions step 3 changed: open to everyone again
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public._m169_function_grants') IS NOT NULL THEN
    FOR r IN SELECT sig FROM public._m169_function_grants LOOP
      BEGIN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.sig);
      EXCEPTION WHEN undefined_function THEN NULL;  -- a function that no longer exists
      END;
    END LOOP;
    DROP TABLE public._m169_function_grants;
  END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
COMMIT;
