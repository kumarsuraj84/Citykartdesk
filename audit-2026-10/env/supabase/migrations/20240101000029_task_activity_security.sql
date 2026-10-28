-- Remove any permissive INSERT policies on task_activity
DROP POLICY IF EXISTS "task_activity_insert" ON task_activity;
DROP POLICY IF EXISTS "Users can log task activity" ON task_activity;
DROP POLICY IF EXISTS "Team members can log activity" ON task_activity;
DROP POLICY IF EXISTS "Authenticated users can log task activity" ON task_activity;

-- RESTRICTIVE deny: all authenticated inserts blocked (matches request_activity pattern)
-- service_role (admin client) bypasses RLS and remains unaffected
DO $body$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='task_activity' AND policyname='task_activity_insert_deny'
  ) THEN
    EXECUTE 'CREATE POLICY task_activity_insert_deny ON task_activity AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false)';
  END IF;
END $body$;
