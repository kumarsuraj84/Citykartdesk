-- Migration: Security Hardening
-- Tighten storage, notifications, comments, tasks, collaborators, and time entries policies

-- 1. Tighten storage INSERT policy for request-attachments bucket (service_role only)
DROP POLICY IF EXISTS "Users can upload attachments" ON storage.objects;
CREATE POLICY "Service role only upload" ON storage.objects
  FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'request-attachments');

-- 2. Restrictive INSERT policy on notifications (users can only insert for themselves)
DROP POLICY IF EXISTS "notifications_insert_restrictive" ON public.notifications;
CREATE POLICY "notifications_insert_own_only" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 3. Explicit DELETE deny on request_comments (immutable)
CREATE POLICY "comments_immutable" ON request_comments
  FOR DELETE TO authenticated
  USING (false);

-- 4. Scoped DELETE on tasks (creator or manager/admin)
CREATE POLICY "tasks_delete" ON tasks
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

-- 5. Tighten request_collaborators SELECT to team scope
DROP POLICY IF EXISTS "collab_select" ON request_collaborators;
CREATE POLICY "collab_select" ON request_collaborators
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR added_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
      AND (
        r.requester_id = auth.uid()
        OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = r.team_id AND tm.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('manager','admin'))
      )
    )
  );

-- 6. Ensure GRANT ALL on request_time_entries (only if the table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'request_time_entries'
  ) THEN
    EXECUTE 'GRANT ALL ON TABLE request_time_entries TO anon, authenticated, service_role';
  END IF;
END $$;
