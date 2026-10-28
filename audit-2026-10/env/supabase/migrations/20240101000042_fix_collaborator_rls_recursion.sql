-- Fix infinite recursion in requests_select RLS policy.
--
-- Root cause: collab_insert policy on request_collaborators queries requests
-- (to get team_id), which triggers requests_select, which calls
-- is_request_collaborator(), which queries request_collaborators — cycle.
-- PostgreSQL detects this at plan time → 42P17 on ANY requests query,
-- breaking every page that touches requests (including the layout nav counts).
--
-- Fix: drop the collaborator visibility clause from requests_select.
-- Collaborators can still read requests via the team/admin/requester checks.
-- The is_request_collaborator() path can be re-added once collab_insert is
-- rewritten to use a SECURITY DEFINER helper that bypasses the requests RLS.

DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  requester_id = auth.uid()
  OR is_team_member(team_id)
  OR current_user_role() IN ('manager','admin')
);
